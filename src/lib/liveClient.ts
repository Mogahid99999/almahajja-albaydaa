/**
 * LiveKit room wrapper for «الحلقة» (V23 P3 — PLAN_LIVE_V23 §7.2/§7.3/§7.5).
 *
 * The ONLY file that imports `@livekit/react-native` / `livekit-client`. Both are
 * required LAZILY (first join, or the post-boot warm-up scheduled by
 * `initLiveKit()`): the web admin never evaluates them, Jest never loads them,
 * and cold start doesn't pay for evaluating the SDK.
 *
 * One room at a time. `connectLive()` runs a connect loop (≤ 3 attempts, then
 * `failed`), maps every room event through the pure reducer in
 * src/lib/liveConnection.ts and pushes BATCHED patches to a sink (the store):
 *   - conn / hostPresent: immediately, only when they change;
 *   - people / counts: coalesced (≤ 1 patch per PEOPLE_FLUSH_MS) — a burst of
 *     200 joins is a handful of store writes, not 200;
 *   - activeSpeakers: on ActiveSpeakersChanged only (server-side cadence), and
 *     only the persons whose `speaking` flag flips are copied. Audio levels are
 *     never read.
 * A drop LiveKit can't resume itself (Disconnected, not by us / not ended) is
 * re-joined with a fresh token — waiting for the network first when offline
 * («سنعيدك إلى الحلقة تلقائياً عند عودته»).
 *
 * P4 (speaking): the microphone is published with the `speech` preset (24 kbps
 * Opus) + RED + DTX so a speaker survives a weak network; a mute keeps the
 * track published (instant unmute, no renegotiation). Permissions and
 * attributes are SERVER-set only (live-control) — nothing here writes them.
 */
import { onlineManager } from "@tanstack/react-query";
import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from "react-native";
import type * as LKRN from "@livekit/react-native";
import type * as LK from "livekit-client";

import {
  classifyDisconnect,
  connReducer,
  countPeople,
  deriveConn,
  HOST_AUDIO_GRACE_MS,
  initialConnState,
  sameIds,
  toLivePerson,
  withSpeaking,
  type ConnEvent,
  type ConnState,
  type LiveConn,
  type LivePerson,
} from "@/lib/liveConnection";

// ─── SDK loading / init ─────────────────────────────────────────────────────────

type Sdk = { rn: typeof LKRN; lk: typeof LK };

let sdk: Sdk | null = null;
let registered = false;
let warmupTimer: ReturnType<typeof setTimeout> | null = null;

/** Post-boot delay before the idle warm-up registers the WebRTC globals. */
const LIVEKIT_WARMUP_DELAY_MS = 2500;

/**
 * iOS audio session policy (applied natively as the WebRTC audio engine
 * changes state): LISTENING = `playback` / `spokenAudio` (exclusive, like the
 * lecture player's doNotMix); SPEAKING (P4) = `playAndRecord`, speaker by
 * default, Bluetooth allowed. Android is configured per join
 * ({@link configureListeningAudio}).
 */
const IOS_AUDIO_POLICY: LKRN.IOSAudioSessionPolicy = {
  playout: {
    audioCategory: "playback",
    audioCategoryOptions: [],
    audioMode: "spokenAudio",
  },
  recording: {
    audioCategory: "playAndRecord",
    audioCategoryOptions: [
      "allowBluetooth",
      "allowBluetoothA2DP",
      "allowAirPlay",
      "defaultToSpeaker",
    ],
    audioMode: "videoChat",
  },
  recordingWithoutVoiceProcessing: {
    audioCategory: "playAndRecord",
    audioCategoryOptions: [
      "allowBluetooth",
      "allowBluetoothA2DP",
      "allowAirPlay",
      "defaultToSpeaker",
    ],
    audioMode: "default",
  },
  deactivateOnStop: true,
};

function loadSdk(): Sdk {
  if (Platform.OS === "web") throw new Error("live audio is native-only");
  if (!sdk) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("@livekit/react-native") as typeof LKRN;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lk = require("livekit-client") as typeof LK;
    sdk = { rn, lk };
  }
  return sdk;
}

/**
 * Load the SDK and call `registerGlobals()` exactly once (WebRTC globals,
 * polyfills, native events) + install the iOS audio policy. Idempotent; called
 * by every entry point below, so a join works even before the warm-up ran.
 */
export function ensureLiveKit(): Sdk {
  const s = loadSdk();
  if (!registered) {
    s.rn.registerGlobals({ autoConfigureAudioSession: false });
    s.rn.setupIOSAudioManagement(true, IOS_AUDIO_POLICY);
    try {
      s.lk.setLogLevel(s.lk.LogLevel.warn);
    } catch {
      /* logging only */
    }
    registered = true;
  }
  return s;
}

/**
 * App-boot hook (app/_layout.tsx, module scope). Native only; schedules the
 * one-time `registerGlobals()` shortly AFTER boot so the SDK's evaluation never
 * lands on the cold-start path. Never throws (Expo Go / a binary without the
 * native module just skips it — a join then reports `failed`).
 */
export function initLiveKit(): void {
  if (Platform.OS === "web" || registered || warmupTimer) return;
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    try {
      ensureLiveKit();
    } catch {
      /* native module missing — joins will surface it */
    }
  }, LIVEKIT_WARMUP_DELAY_MS);
}

// ─── Audio session (§7.2) ───────────────────────────────────────────────────────

let androidAudioActive = false;

/**
 * LISTENING audio session, before connecting: Android = the `media` preset
 * (STREAM_MUSIC, usage media, mode normal, focus gain — media volume keys,
 * loudspeaker, never the earpiece); iOS = `playback` via the policy installed in
 * ensureLiveKit (the native side activates it with the audio engine).
 */
export async function configureListeningAudio(): Promise<void> {
  if (Platform.OS === "web") return;
  const { rn } = ensureLiveKit();
  await rn.AudioSession.configureAudio({
    android: {
      preferredOutputList: ["bluetooth", "headset", "speaker"],
      audioTypeOptions: rn.AndroidAudioTypePresets.media,
    },
  });
  if (Platform.OS === "android") {
    if (androidAudioActive) await rn.AudioSession.stopAudioSession();
    await rn.AudioSession.startAudioSession();
    androidAudioActive = true;
    androidProfile = "listening";
  }
}

/**
 * Android audio profile of the running session. LISTENING = `media`; SPEAKING
 * = `communication` (MODE_IN_COMMUNICATION + voice-call usage: the hardware
 * echo canceller works against the room audio, so a speaker on the loudspeaker
 * doesn't feed the sheikh's voice back into the room / recording). Loudspeaker
 * stays preferred over the earpiece. Switched with a session restart (the
 * AudioSwitch mode/focus only apply on start).
 */
let androidProfile: "listening" | "speaking" = "listening";

async function applyAndroidProfile(
  profile: "listening" | "speaking",
): Promise<void> {
  const { rn } = ensureLiveKit();
  if (androidAudioActive) await rn.AudioSession.stopAudioSession();
  await rn.AudioSession.configureAudio({
    android: {
      preferredOutputList: ["bluetooth", "headset", "speaker"],
      audioTypeOptions:
        profile === "speaking"
          ? rn.AndroidAudioTypePresets.communication
          : rn.AndroidAudioTypePresets.media,
    },
  });
  await rn.AudioSession.startAudioSession();
  androidAudioActive = true;
  androidProfile = profile;
}

/**
 * SPEAKING audio session (the host from the green room; a speaker/moderator
 * opening the mic). iOS switches to playAndRecord by itself (IOS_AUDIO_POLICY).
 */
export async function configureSpeakingAudio(): Promise<void> {
  if (Platform.OS !== "android") return;
  if (androidAudioActive && androidProfile === "speaking") return;
  await applyAndroidProfile("speaking");
}

/** Back to LISTENING once the mic is gone (demoted / stepped down), still in the room. */
async function restoreListeningAudio(): Promise<void> {
  if (
    Platform.OS !== "android" ||
    !androidAudioActive ||
    androidProfile === "listening"
  )
    return;
  await applyAndroidProfile("listening");
}

/** Release the audio session (leave). iOS deactivates natively (deactivateOnStop). */
export async function stopLiveAudio(): Promise<void> {
  if (Platform.OS !== "android" || !androidAudioActive) return;
  androidAudioActive = false;
  androidProfile = "listening";
  try {
    await ensureLiveKit().rn.AudioSession.stopAudioSession();
  } catch {
    /* already released */
  }
}

// ─── Room ───────────────────────────────────────────────────────────────────────

/** What the store receives. Keys match `LiveState` fields. */
export interface LiveRoomPatch {
  conn?: LiveConn;
  people?: Record<string, LivePerson>;
  activeSpeakers?: string[];
  counts?: { brothers: number; sisters: number };
  hostPresent?: boolean;
  /** My microphone is published and unmuted. */
  micOn?: boolean;
  /** Room metadata «استقبال طلبات الكلمة». */
  allowRequests?: boolean;
}

/** One-shot room happenings (P4) the store turns into notices. */
export type LiveClientEvent =
  /** A moderator declined my request (data message {t:'rejected'}, topic control). */
  | { type: "rejected" }
  /** My mic was muted by a moderator (MutePublishedTrack), not by me. */
  | { type: "mutedByModerator" }
  /** My publish permission was revoked (demoted) — the mic is already dropped. */
  | { type: "publishRevoked" };

export interface LiveSink {
  patch(p: LiveRoomPatch): void;
  event?(e: LiveClientEvent): void;
}

export interface LiveConnectParams {
  url: string;
  token: string;
  /** A fresh token (live-token) for retries and re-joins after a drop. */
  refresh: () => Promise<{ url: string; token: string }>;
  /** The store's listen-pause, read when the room connects (a pause pressed while connecting sticks). */
  isPaused?: () => boolean;
}

/** Thrown out of a connect run that `disconnectLive()` superseded. */
export class LiveCancelledError extends Error {
  constructor() {
    super("live connect cancelled");
    this.name = "LiveCancelledError";
    Object.setPrototypeOf(this, LiveCancelledError.prototype);
  }
}

const PEOPLE_FLUSH_MS = 250;
const RETRY_BASE_MS = 1000;
/** Re-join backoff ceiling: a weak network keeps trying every ≤ 15 s, never hammering. */
const RETRY_MAX_MS = 15_000;
/**
 * Weak networks (2G/EDGE, a crowded mosque Wi-Fi): signalling runs through the
 * Cloudflare tunnel and ICE may fall back to TCP 7881 — give each step 30 s
 * (livekit-client's defaults are 15 s) before counting an attempt as failed.
 */
const CONNECT_OPTIONS = {
  autoSubscribe: true,
  websocketTimeout: 30_000,
  peerConnectionTimeout: 30_000,
} as const;

type Run = {
  sink: LiveSink;
  params: LiveConnectParams;
  room: LK.Room | null;
  conn: ConnState;
  lastConn: LiveConn;
  lastHostPresent: boolean;
  people: Record<string, LivePerson>;
  speakers: string[];
  peopleTimer: ReturnType<typeof setTimeout> | null;
  hostTimer: ReturnType<typeof setTimeout> | null;
  onlineWaiters: (() => void)[];
  offNetwork: () => void;
  rejoining: boolean;
  micOn: boolean;
  /**
   * What I last asked of my mic — restored after a full re-join (a new Room
   * has no tracks): a sheikh whose network dropped must not come back silent.
   */
  micWanted: "off" | "muted" | "on";
  /** Set while WE mute our own mic, so the TrackMuted it causes isn't «muted by a moderator». */
  selfMuting: boolean;
  allowRequests: boolean | null;
};

let run: Run | null = null;
/** Local listen-pause: remote audio is unsubscribed; the room stays connected. */
let paused = false;

function emit(r: Run, patch: LiveRoomPatch) {
  if (run === r && Object.keys(patch).length > 0) r.sink.patch(patch);
}

function dispatch(r: Run, ev: ConnEvent) {
  if (run !== r) return;
  r.conn = connReducer(r.conn, ev);
  const patch: LiveRoomPatch = {};
  const conn = deriveConn(r.conn);
  if (conn !== r.lastConn) {
    r.lastConn = conn;
    patch.conn = conn;
  }
  if (r.conn.hostPresent !== r.lastHostPresent) {
    r.lastHostPresent = r.conn.hostPresent;
    patch.hostPresent = r.conn.hostPresent;
  }
  emit(r, patch);
  if (r.conn.hostAudioLostAt != null && !r.conn.hostDropped)
    scheduleHostTick(r);
}

function scheduleHostTick(r: Run) {
  if (r.hostTimer || r.conn.hostAudioLostAt == null) return;
  const wait =
    Math.max(0, r.conn.hostAudioLostAt + HOST_AUDIO_GRACE_MS - Date.now()) + 50;
  r.hostTimer = setTimeout(() => {
    r.hostTimer = null;
    dispatch(r, { type: "tick", now: Date.now() });
  }, wait);
}

function isHostParticipant(p: LK.Participant): boolean {
  return p.attributes?.r === "host";
}

/** Host presence + microphone track → the reducer (hostdrop). */
function syncHost(r: Run) {
  const room = r.room;
  if (run !== r || !room || !sdk) return;
  const { lk } = sdk;
  const at = Date.now();
  if (isHostParticipant(room.localParticipant)) {
    dispatch(r, { type: "host", present: true, hasAudio: true, at });
    return;
  }
  let host: LK.RemoteParticipant | undefined;
  for (const p of room.remoteParticipants.values()) {
    if (isHostParticipant(p)) {
      host = p;
      break;
    }
  }
  // A muted mic still counts (a pause in speech is not a drop); a host whose
  // connection is `lost` has no audio flowing → the grace clock runs.
  const lost = host?.connectionQuality === lk.ConnectionQuality.Lost;
  const hasAudio =
    !!host && !lost && !!host.getTrackPublication(lk.Track.Source.Microphone);
  if (hasAudio && r.hostTimer) {
    clearTimeout(r.hostTimer);
    r.hostTimer = null;
  }
  dispatch(r, { type: "host", present: !!host, hasAudio, at });
}

function flushPeople(r: Run) {
  if (r.peopleTimer) {
    clearTimeout(r.peopleTimer);
    r.peopleTimer = null;
  }
  const room = r.room;
  if (run !== r || !room || !sdk) return;
  const { lk } = sdk;
  const speaking = new Set(r.speakers);
  const people: Record<string, LivePerson> = {};
  const me = room.localParticipant;
  const micOn = (p: LK.Participant) => {
    const pub = p.getTrackPublication(lk.Track.Source.Microphone);
    return !!pub && !pub.isMuted;
  };
  people[me.identity] = toLivePerson(me, {
    isMe: true,
    speaking: speaking.has(me.identity),
    micOn: micOn(me),
  });
  for (const p of room.remoteParticipants.values()) {
    // Only app users are attendees (never an egress recorder / ingress / agent).
    if (p.kind !== lk.ParticipantKind.STANDARD) continue;
    people[p.identity] = toLivePerson(p, {
      isMe: false,
      speaking: speaking.has(p.identity),
      micOn: micOn(p),
    });
  }
  r.people = people;
  emit(r, { people, counts: countPeople(people) });
}

function schedulePeople(r: Run) {
  if (r.peopleTimer || run !== r) return;
  r.peopleTimer = setTimeout(() => {
    r.peopleTimer = null;
    flushPeople(r);
  }, PEOPLE_FLUSH_MS);
}

function onSpeakers(r: Run, ids: string[]) {
  if (sameIds(ids, r.speakers)) return;
  r.speakers = ids;
  const people = withSpeaking(r.people, ids);
  const patch: LiveRoomPatch = { activeSpeakers: ids };
  if (people !== r.people) {
    r.people = people;
    patch.people = people;
  }
  emit(r, patch);
}

function applyPaused(r: Run) {
  const room = r.room;
  if (!room) return;
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.audioTrackPublications.values()) {
      try {
        pub.setSubscribed(!paused);
      } catch {
        /* publication went away */
      }
    }
  }
}

function waitForOnline(r: Run): Promise<void> {
  if (run !== r || r.conn.online) return Promise.resolve();
  return new Promise((resolve) => r.onlineWaiters.push(resolve));
}

function releaseWaiters(r: Run) {
  const waiters = r.onlineWaiters.splice(0);
  for (const w of waiters) w();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCurrent(r: Run) {
  if (run !== r) throw new LiveCancelledError();
}

function createRoom(r: Run): LK.Room {
  const { lk } = ensureLiveKit();
  const room = new lk.Room({
    adaptiveStream: false,
    dynacast: false,
    disconnectOnPageLeave: false,
  });
  const E = lk.RoomEvent;
  const current = () => run === r && r.room === room;
  const onParticipants = () => {
    if (!current()) return;
    schedulePeople(r);
    syncHost(r);
  };
  room
    .on(E.Reconnecting, () => {
      if (current()) dispatch(r, { type: "reconnecting" });
    })
    .on(E.Reconnected, () => {
      if (!current()) return;
      dispatch(r, { type: "reconnected" });
      applyPaused(r);
      flushPeople(r);
      syncHost(r);
    })
    .on(E.Disconnected, (reason?: number) => {
      if (current()) onDisconnected(r, room, reason);
    })
    .on(
      E.ConnectionQualityChanged,
      (quality: LK.ConnectionQuality, p: LK.Participant) => {
        if (!current()) return;
        if (p.isLocal) dispatch(r, { type: "quality", quality });
        else if (isHostParticipant(p)) syncHost(r);
      },
    )
    .on(E.ParticipantConnected, onParticipants)
    .on(E.ParticipantDisconnected, onParticipants)
    .on(E.ParticipantAttributesChanged, onParticipants)
    .on(E.ParticipantNameChanged, () => {
      if (current()) schedulePeople(r);
    })
    .on(E.TrackPublished, (pub: LK.RemoteTrackPublication) => {
      if (!current()) return;
      if (paused && pub.kind === lk.Track.Kind.Audio) pub.setSubscribed(false);
      syncHost(r);
      schedulePeople(r);
    })
    .on(E.TrackUnpublished, () => {
      if (!current()) return;
      syncHost(r);
      schedulePeople(r);
    })
    .on(E.TrackMuted, (pub: LK.TrackPublication, p: LK.Participant) => {
      if (!current()) return;
      if (p.isLocal) {
        if (pub.source === lk.Track.Source.Microphone) {
          // A moderator's mute sticks through a re-join too (never republished open).
          if (r.micWanted === "on") r.micWanted = "muted";
          if (!r.selfMuting) r.sink.event?.({ type: "mutedByModerator" });
        }
        syncMic(r);
      }
      schedulePeople(r);
    })
    .on(E.TrackUnmuted, (pub: LK.TrackPublication, p: LK.Participant) => {
      if (!current()) return;
      if (p.isLocal) {
        if (
          pub.source === lk.Track.Source.Microphone &&
          r.micWanted === "muted"
        )
          r.micWanted = "on";
        syncMic(r);
      }
      schedulePeople(r);
    })
    .on(E.LocalTrackPublished, () => {
      if (!current()) return;
      syncMic(r);
      schedulePeople(r);
    })
    .on(E.LocalTrackUnpublished, () => {
      if (!current()) return;
      syncMic(r);
      schedulePeople(r);
    })
    .on(
      E.ParticipantPermissionsChanged,
      (_prev: unknown, p: LK.Participant) => {
        if (!current()) return;
        if (p.isLocal && !p.permissions?.canPublish) void dropMic(r, true);
        schedulePeople(r);
      },
    )
    .on(E.RoomMetadataChanged, (metadata: string) => {
      if (current()) syncAllowRequests(r, metadata);
    })
    .on(
      E.DataReceived,
      (
        payload: Uint8Array,
        _p?: LK.RemoteParticipant,
        _k?: LK.DataPacket_Kind,
        topic?: string,
      ) => {
        if (!current() || topic !== "control") return;
        if (parseControlMessage(payload) === "rejected")
          r.sink.event?.({ type: "rejected" });
      },
    )
    .on(
      E.TrackSubscribed,
      (_track: LK.RemoteTrack, pub: LK.RemoteTrackPublication) => {
        if (current() && paused && pub.kind === lk.Track.Kind.Audio)
          pub.setSubscribed(false);
      },
    )
    .on(E.ActiveSpeakersChanged, (speakers: LK.Participant[]) => {
      if (current())
        onSpeakers(
          r,
          speakers.map((s) => s.identity),
        );
    });
  return room;
}

function onDisconnected(r: Run, room: LK.Room, reason?: number) {
  room.removeAllListeners();
  r.room = null;
  if (r.peopleTimer) clearTimeout(r.peopleTimer);
  if (r.hostTimer) clearTimeout(r.hostTimer);
  r.peopleTimer = null;
  r.hostTimer = null;
  const kind = classifyDisconnect(reason);
  dispatch(r, { type: "disconnected", kind });
  if (kind === "lost") void rejoin(r);
}

async function rejoin(r: Run) {
  if (r.rejoining) return;
  r.rejoining = true;
  try {
    await connectLoop(r, null, true);
  } catch {
    // Final failure is already `failed` in the store (reducer); a cancelled run is silent.
  } finally {
    r.rejoining = false;
  }
}

/**
 * Connect (or re-join) until connected, cancelled, or the 3rd failure. A
 * re-join waits for the network first and always uses a fresh token.
 */
async function connectLoop(
  r: Run,
  first: { url: string; token: string } | null,
  rejoin: boolean,
) {
  let creds = first;
  for (;;) {
    assertCurrent(r);
    if (rejoin && !r.conn.online) {
      await waitForOnline(r);
      continue;
    }
    dispatch(r, { type: "connect", rejoin });
    let room: LK.Room | null = null;
    try {
      if (!creds) creds = await r.params.refresh();
      assertCurrent(r);
      room = createRoom(r);
      await room.connect(creds.url, creds.token, CONNECT_OPTIONS);
      assertCurrent(r);
      r.room = room;
      dispatch(r, { type: "connected" });
      applyPaused(r);
      flushPeople(r);
      // ActiveSpeakersChanged fires on CHANGES only: someone already talking
      // when we join (the sheikh mid-sentence, a steady voice) never produces
      // one — seed the list from the room (found on device: «لا أحد يتحدث»
      // under a speaking host).
      onSpeakers(
        r,
        room.activeSpeakers.map((p) => p.identity),
      );
      syncHost(r);
      syncAllowRequests(r, room.metadata);
      syncMic(r);
      const q = room.localParticipant.connectionQuality;
      if (q) dispatch(r, { type: "quality", quality: q });
      if (!room.localParticipant.permissions?.canPublish) {
        // Demoted while between rooms (the revoke event fired on no room): a
        // listener again — no mic, listening profile, service without mic type.
        if (r.micWanted !== "off" || androidProfile === "speaking") {
          r.micWanted = "off";
          void restoreListeningAudio().catch(() => undefined);
          r.sink.event?.({ type: "publishRevoked" });
        }
      } else if (rejoin && r.micWanted !== "off") void restoreMic(r, room);
      return;
    } catch (e) {
      if (room) {
        room.removeAllListeners();
        void room.disconnect().catch(() => undefined);
      }
      if (run !== r || e instanceof LiveCancelledError)
        throw new LiveCancelledError();
      // live-token says the session is no longer open: it ended while we were
      // away (ROOM_DELETED never reached us) — «انتهى المجلس», not a retry storm.
      if ((e as { code?: unknown } | null)?.code === "not_open") {
        dispatch(r, { type: "sessionEnded" });
        throw e;
      }
      creds = null; // the next attempt asks for a fresh token
      dispatch(r, { type: "connectError" });
      if (r.conn.phase === "failed")
        throw e instanceof Error ? e : new Error(String(e));
      await delay(
        Math.min(
          RETRY_MAX_MS,
          RETRY_BASE_MS * 2 ** Math.min(r.conn.attempts - 1, 4),
        ),
      );
    }
  }
}

/**
 * Join the room. Resolves once connected; rejects after the 3rd failed attempt
 * (the sink has already received `conn: 'failed'`) or with LiveCancelledError
 * when {@link disconnectLive} ran meanwhile. Any previous room is left first.
 */
export async function connectLive(
  params: LiveConnectParams,
  sink: LiveSink,
): Promise<void> {
  await disconnectLive();
  ensureLiveKit();
  const r: Run = {
    sink,
    params,
    room: null,
    conn: { ...initialConnState, online: onlineManager.isOnline() },
    lastConn: "idle",
    lastHostPresent: false,
    people: {},
    speakers: [],
    peopleTimer: null,
    hostTimer: null,
    onlineWaiters: [],
    offNetwork: () => undefined,
    rejoining: false,
    micOn: false,
    micWanted: "off",
    selfMuting: false,
    allowRequests: null,
  };
  run = r;
  paused = params.isPaused?.() ?? false;
  r.offNetwork = onlineManager.subscribe((online) => {
    if (run !== r) return;
    dispatch(r, { type: "network", online });
    if (online) releaseWaiters(r);
  });
  await connectLoop(r, { url: params.url, token: params.token }, false);
}

/** Leave the room (no events reach the sink afterwards). Safe to call any time. */
export async function disconnectLive(): Promise<void> {
  const r = run;
  run = null;
  paused = false;
  stopMicMeter();
  if (!r) return;
  if (r.peopleTimer) clearTimeout(r.peopleTimer);
  if (r.hostTimer) clearTimeout(r.hostTimer);
  r.peopleTimer = null;
  r.hostTimer = null;
  r.offNetwork();
  releaseWaiters(r);
  const room = r.room;
  r.room = null;
  if (room) {
    room.removeAllListeners();
    try {
      await Promise.race([room.disconnect(), delay(5000)]);
    } catch {
      /* already gone */
    }
  }
}

/** Local listen-pause: unsubscribe (pause) / re-subscribe (resume) every remote audio track. */
export function setLivePaused(p: boolean): void {
  paused = p;
  if (run) applyPaused(run);
}

/** The session row reached an ended status (poll) — the room is over even if no event came. */
export function markSessionEnded(): void {
  if (run) dispatch(run, { type: "sessionEnded" });
}

// ─── P4: speaking ───────────────────────────────────────────────────────────────
// Hands go through live-control `hand` (src/api/live.ts) — the server sets `h`.

/** Room metadata `{allowRequests}` (live-control set_allow_requests). Missing/unparseable → allowed. */
export function parseAllowRequests(
  metadata: string | null | undefined,
): boolean {
  if (!metadata) return true;
  try {
    const m = JSON.parse(metadata) as { allowRequests?: unknown } | null;
    return m?.allowRequests !== false;
  } catch {
    return true;
  }
}

/** A data message on topic `control` → its `t` ('rejected' today); null when unreadable. */
export function parseControlMessage(payload: Uint8Array): string | null {
  try {
    let text = "";
    for (let i = 0; i < payload.length; i++)
      text += String.fromCharCode(payload[i]);
    const m = JSON.parse(text) as { t?: unknown } | null;
    return typeof m?.t === "string" ? m.t : null;
  } catch {
    return null;
  }
}

function syncAllowRequests(r: Run, metadata: string | null | undefined) {
  const allow = parseAllowRequests(metadata);
  if (allow === r.allowRequests) return;
  r.allowRequests = allow;
  emit(r, { allowRequests: allow });
}

function syncMic(r: Run) {
  const room = r.room;
  if (run !== r || !room || !sdk) return;
  const pub = room.localParticipant.getTrackPublication(
    sdk.lk.Track.Source.Microphone,
  );
  const on = !!pub && !pub.isMuted;
  if (!on) stopMicMeter();
  if (on === r.micOn) return;
  r.micOn = on;
  emit(r, { micOn: on });
}

/**
 * The mic is no longer ours (demoted / stepped down): unpublish + stop the
 * capture (the OS mic indicator goes off), then back to the listening profile.
 */
async function dropMic(r: Run, revoked: boolean) {
  const room = r.room;
  if (!room || !sdk) return;
  const pub = room.localParticipant.getTrackPublication(
    sdk.lk.Track.Source.Microphone,
  );
  if (pub?.track) {
    try {
      await room.localParticipant.unpublishTrack(
        pub.track as LK.LocalTrack,
        true,
      );
    } catch {
      /* the server already removed it */
    }
  }
  r.micWanted = "off";
  stopMicMeter();
  syncMic(r);
  await restoreListeningAudio().catch(() => undefined);
  if (revoked && run === r) r.sink.event?.({ type: "publishRevoked" });
}

/** Thrown by {@link setMicEnabled} when the OS microphone permission is refused. */
export class MicPermissionError extends Error {
  constructor() {
    super("mic_denied");
    this.name = "MicPermissionError";
    Object.setPrototypeOf(this, MicPermissionError.prototype);
  }
}

/** Resolves `true` when the OS dialog was actually shown (see {@link settleAfterDialog}). */
async function ensureMicPermission(): Promise<boolean> {
  // iOS asks by itself on the first capture (NSMicrophoneUsageDescription).
  if (Platform.OS !== "android") return false;
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(perm)) return false;
  const res = await PermissionsAndroid.request(perm);
  if (res !== PermissionsAndroid.RESULTS.GRANTED)
    throw new MicPermissionError();
  return true;
}

/** After the OS dialog: LiveKit's overdue ping check fires as JS resumes. */
const DIALOG_SETTLE_MS = 1500;
/** Waiting for the room to be connected (again) before publishing / for a publish. */
const PUBLISH_WAIT_MS = 20_000;

/** Resolves once `room` is connected (at once if it is); rejects after `ms`. */
function waitRoomConnected(room: LK.Room, ms: number): Promise<void> {
  const { lk } = ensureLiveKit();
  if (room.state === lk.ConnectionState.Connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(t);
      room.off(lk.RoomEvent.ConnectionStateChanged, onState);
      if (ok) resolve();
      else reject(new Error("not_connected"));
    };
    const onState = (s: LK.ConnectionState) => {
      if (s === lk.ConnectionState.Connected) done(true);
      else if (s === lk.ConnectionState.Disconnected) done(false);
    };
    const t = setTimeout(() => done(false), ms);
    room.on(lk.RoomEvent.ConnectionStateChanged, onState);
  });
}

/**
 * Behind the OS permission dialog our activity is paused and React Native's JS
 * timers stop; when it closes, LiveKit's overdue signal-ping check fires and
 * the room reconnects — replacing the peer connection. A publish started at
 * that instant hangs forever (found on R5CX10P3BPL), so wait for the room to
 * settle first.
 */
async function settleAfterDialog(room: LK.Room): Promise<void> {
  await delay(DIALOG_SETTLE_MS);
  await waitRoomConnected(room, PUBLISH_WAIT_MS);
}

/** Asks the OS microphone permission (Android) BEFORE a mic-type foreground service starts. Throws MicPermissionError. */
export async function requestMicPermission(): Promise<void> {
  await ensureMicPermission();
}

/**
 * Open/close my mic (decision 6: a speaker toggles freely; a moderator's mute
 * is temporary). Opening asks the OS permission, switches to the speaking
 * audio profile and publishes `speech` (24 kbps Opus) + RED + DTX; closing
 * MUTES (the publication stays, so reopening is instant on a weak network).
 * Throws MicPermissionError, or when not connected / not allowed to publish.
 */
export async function setMicEnabled(on: boolean): Promise<void> {
  const r = run;
  const room = r?.room;
  if (!r || !room) throw new Error("not_connected");
  const { lk } = ensureLiveKit();
  if (on) {
    if (!room.localParticipant.permissions?.canPublish)
      throw new Error("not_allowed");
    const dialog = await ensureMicPermission();
    if (dialog) await settleAfterDialog(room);
    else await waitRoomConnected(room, PUBLISH_WAIT_MS);
    await configureSpeakingAudio();
    assertCurrent(r);
    if (r.room !== room || !room.localParticipant.permissions?.canPublish) {
      // Demoted (or the room changed) while the OS permission dialog was up.
      await restoreListeningAudio().catch(() => undefined);
      throw new Error("not_allowed");
    }
    // A publish caught by a reconnect can hang for good — never leave the mic
    // button busy forever.
    await Promise.race([
      publishMic(room, lk),
      delay(PUBLISH_WAIT_MS).then(() => {
        throw new Error("publish_timeout");
      }),
    ]);
    r.micWanted = "on";
  } else {
    await muteMic(r, room);
    r.micWanted = "muted";
  }
  syncMic(r);
}

const MIC_CAPTURE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;
/** Speech preset (24 kbps Opus) + RED (redundant frames against loss) + DTX (near-silent pauses). */
const MIC_PUBLISH = (lk: typeof LK) => ({
  audioPreset: lk.AudioPresets.speech,
  red: true,
  dtx: true,
});

function publishMic(room: LK.Room, lk: typeof LK) {
  return room.localParticipant.setMicrophoneEnabled(
    true,
    MIC_CAPTURE,
    MIC_PUBLISH(lk),
  );
}

async function muteMic(r: Run, room: LK.Room) {
  r.selfMuting = true;
  try {
    await room.localParticipant.setMicrophoneEnabled(false);
  } finally {
    r.selfMuting = false;
  }
}

/** After a full re-join: put the mic back as it was (published, and muted if it was muted). */
async function restoreMic(r: Run, room: LK.Room) {
  if (!sdk || !room.localParticipant.permissions?.canPublish) return;
  const { lk } = sdk;
  try {
    if (r.micWanted === "on") {
      await publishMic(room, lk);
    } else {
      // Muted: create the track muted and publish it muted (AddTrack carries
      // the flag) — no instant of live audio from a mic that was closed.
      const track = await lk.createLocalAudioTrack(MIC_CAPTURE);
      await track.mute();
      if (run !== r || r.room !== room) {
        track.stop();
        return;
      }
      r.selfMuting = true;
      try {
        await room.localParticipant.publishTrack(track, MIC_PUBLISH(lk));
      } finally {
        r.selfMuting = false;
      }
    }
  } catch {
    // The permission was revoked meanwhile, or the room dropped again (the next re-join retries).
  }
  if (run === r && r.room === room) syncMic(r);
}

/** Stepping down: drop my mic while staying in the room (the server revokes publish as well). */
export async function releaseMic(): Promise<void> {
  const r = run;
  if (r) await dropMic(r, false);
}

// ─── Green-room mic meter ───────────────────────────────────────────────────────
// The native volume processor sends an event per audio frame over the bridge,
// so it runs only while someone polls getMicLevel() (the green room) and stops
// itself METER_IDLE_MS after the last poll.

const METER_IDLE_MS = 1500;
let micLevel = 0;
let meterTag: string | null = null;
let meterTrack: { pc: number; id: string } | null = null;
let meterSub: { remove(): void } | null = null;
let meterIdle: ReturnType<typeof setTimeout> | null = null;

type VolumeModule = {
  createVolumeProcessor(pc: number, trackId: string): string;
  deleteVolumeProcessor(tag: string, pc: number, trackId: string): void;
};

function volumeModule(): VolumeModule | undefined {
  return (NativeModules as Record<string, unknown>).LivekitReactNativeModule as
    VolumeModule | undefined;
}

function startMicMeter(): void {
  if (meterTag || !run?.room || !sdk) return;
  const pub = run.room.localParticipant.getTrackPublication(
    sdk.lk.Track.Source.Microphone,
  );
  const mst = pub?.track?.mediaStreamTrack as unknown as
    { id?: string; _peerConnectionId?: number } | undefined;
  const mod = volumeModule();
  if (!mst?.id || !mod || pub?.isMuted) return;
  try {
    const pc = mst._peerConnectionId ?? -1;
    const tag = mod.createVolumeProcessor(pc, mst.id);
    meterTag = tag;
    meterTrack = { pc, id: mst.id };
    meterSub = new NativeEventEmitter(mod as never).addListener(
      "LK_VOLUME_PROCESSED",
      (e: { id?: string; volume?: number }) => {
        if (e?.id === tag && typeof e.volume === "number")
          micLevel = Math.max(0, Math.min(1, e.volume));
      },
    );
  } catch {
    meterTag = null;
    meterTrack = null;
  }
}

function stopMicMeter(): void {
  if (meterIdle) clearTimeout(meterIdle);
  meterIdle = null;
  micLevel = 0;
  meterSub?.remove();
  meterSub = null;
  const mod = volumeModule();
  if (meterTag && meterTrack && mod) {
    try {
      mod.deleteVolumeProcessor(meterTag, meterTrack.pc, meterTrack.id);
    } catch {
      /* track already gone */
    }
  }
  meterTag = null;
  meterTrack = null;
}

/** My mic level 0..1 for the green-room meter (starts the meter on demand); 0 while the mic is closed. */
export function getMicLevel(): number {
  if (!run?.micOn) return 0;
  startMicMeter();
  if (meterIdle) clearTimeout(meterIdle);
  meterIdle = setTimeout(stopMicMeter, METER_IDLE_MS);
  return micLevel;
}
