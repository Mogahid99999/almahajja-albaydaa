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
 * Listening only in P3: no microphone. The P4 hooks at the bottom are TODOs.
 */
import { onlineManager } from '@tanstack/react-query';
import { Platform } from 'react-native';
import type * as LKRN from '@livekit/react-native';
import type * as LK from 'livekit-client';

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
} from '@/lib/liveConnection';

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
  playout: { audioCategory: 'playback', audioCategoryOptions: [], audioMode: 'spokenAudio' },
  recording: {
    audioCategory: 'playAndRecord',
    audioCategoryOptions: ['allowBluetooth', 'allowBluetoothA2DP', 'allowAirPlay', 'defaultToSpeaker'],
    audioMode: 'videoChat',
  },
  recordingWithoutVoiceProcessing: {
    audioCategory: 'playAndRecord',
    audioCategoryOptions: ['allowBluetooth', 'allowBluetoothA2DP', 'allowAirPlay', 'defaultToSpeaker'],
    audioMode: 'default',
  },
  deactivateOnStop: true,
};

function loadSdk(): Sdk {
  if (Platform.OS === 'web') throw new Error('live audio is native-only');
  if (!sdk) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('@livekit/react-native') as typeof LKRN;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lk = require('livekit-client') as typeof LK;
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
  if (Platform.OS === 'web' || registered || warmupTimer) return;
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
  if (Platform.OS === 'web') return;
  const { rn } = ensureLiveKit();
  await rn.AudioSession.configureAudio({
    android: {
      preferredOutputList: ['bluetooth', 'headset', 'speaker'],
      audioTypeOptions: rn.AndroidAudioTypePresets.media,
    },
  });
  if (Platform.OS === 'android') {
    await rn.AudioSession.startAudioSession();
    androidAudioActive = true;
  }
}

/** Release the audio session (leave). iOS deactivates natively (deactivateOnStop). */
export async function stopLiveAudio(): Promise<void> {
  if (Platform.OS !== 'android' || !androidAudioActive) return;
  androidAudioActive = false;
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
}

export interface LiveSink {
  patch(p: LiveRoomPatch): void;
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
    super('live connect cancelled');
    this.name = 'LiveCancelledError';
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
const CONNECT_OPTIONS = { autoSubscribe: true, websocketTimeout: 30_000, peerConnectionTimeout: 30_000 } as const;

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
  if (r.conn.hostAudioLostAt != null && !r.conn.hostDropped) scheduleHostTick(r);
}

function scheduleHostTick(r: Run) {
  if (r.hostTimer || r.conn.hostAudioLostAt == null) return;
  const wait = Math.max(0, r.conn.hostAudioLostAt + HOST_AUDIO_GRACE_MS - Date.now()) + 50;
  r.hostTimer = setTimeout(() => {
    r.hostTimer = null;
    dispatch(r, { type: 'tick', now: Date.now() });
  }, wait);
}

function isHostParticipant(p: LK.Participant): boolean {
  return p.attributes?.r === 'host';
}

/** Host presence + microphone track → the reducer (hostdrop). */
function syncHost(r: Run) {
  const room = r.room;
  if (run !== r || !room || !sdk) return;
  const { lk } = sdk;
  const at = Date.now();
  if (isHostParticipant(room.localParticipant)) {
    dispatch(r, { type: 'host', present: true, hasAudio: true, at });
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
  const hasAudio = !!host && !lost && !!host.getTrackPublication(lk.Track.Source.Microphone);
  if (hasAudio && r.hostTimer) {
    clearTimeout(r.hostTimer);
    r.hostTimer = null;
  }
  dispatch(r, { type: 'host', present: !!host, hasAudio, at });
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
  people[me.identity] = toLivePerson(me, { isMe: true, speaking: speaking.has(me.identity) });
  for (const p of room.remoteParticipants.values()) {
    // Only app users are attendees (never an egress recorder / ingress / agent).
    if (p.kind !== lk.ParticipantKind.STANDARD) continue;
    people[p.identity] = toLivePerson(p, { isMe: false, speaking: speaking.has(p.identity) });
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
  const room = new lk.Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false });
  const E = lk.RoomEvent;
  const current = () => run === r && r.room === room;
  const onParticipants = () => {
    if (!current()) return;
    schedulePeople(r);
    syncHost(r);
  };
  room
    .on(E.Reconnecting, () => {
      if (current()) dispatch(r, { type: 'reconnecting' });
    })
    .on(E.Reconnected, () => {
      if (!current()) return;
      dispatch(r, { type: 'reconnected' });
      applyPaused(r);
      flushPeople(r);
      syncHost(r);
    })
    .on(E.Disconnected, (reason?: number) => {
      if (current()) onDisconnected(r, room, reason);
    })
    .on(E.ConnectionQualityChanged, (quality: LK.ConnectionQuality, p: LK.Participant) => {
      if (!current()) return;
      if (p.isLocal) dispatch(r, { type: 'quality', quality });
      else if (isHostParticipant(p)) syncHost(r);
    })
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
    })
    .on(E.TrackUnpublished, () => {
      if (current()) syncHost(r);
    })
    .on(E.TrackSubscribed, (_track: LK.RemoteTrack, pub: LK.RemoteTrackPublication) => {
      if (current() && paused && pub.kind === lk.Track.Kind.Audio) pub.setSubscribed(false);
    })
    .on(E.ActiveSpeakersChanged, (speakers: LK.Participant[]) => {
      if (current()) onSpeakers(r, speakers.map((s) => s.identity));
    });
  // TODO(P4): RoomEvent.DataReceived on topic 'control' — {t:'rejected'} → «اعتذر المشرف…»;
  //           RoomEvent.RoomMetadataChanged — {allowRequests} for «طلب الكلمة».
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
  dispatch(r, { type: 'disconnected', kind });
  if (kind === 'lost') void rejoin(r);
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
async function connectLoop(r: Run, first: { url: string; token: string } | null, rejoin: boolean) {
  let creds = first;
  for (;;) {
    assertCurrent(r);
    if (rejoin && !r.conn.online) {
      await waitForOnline(r);
      continue;
    }
    dispatch(r, { type: 'connect', rejoin });
    let room: LK.Room | null = null;
    try {
      if (!creds) creds = await r.params.refresh();
      assertCurrent(r);
      room = createRoom(r);
      await room.connect(creds.url, creds.token, CONNECT_OPTIONS);
      assertCurrent(r);
      r.room = room;
      dispatch(r, { type: 'connected' });
      applyPaused(r);
      flushPeople(r);
      // ActiveSpeakersChanged fires on CHANGES only: someone already talking
      // when we join (the sheikh mid-sentence, a steady voice) never produces
      // one — seed the list from the room (found on device: «لا أحد يتحدث»
      // under a speaking host).
      onSpeakers(r, room.activeSpeakers.map((p) => p.identity));
      syncHost(r);
      const q = room.localParticipant.connectionQuality;
      if (q) dispatch(r, { type: 'quality', quality: q });
      return;
    } catch (e) {
      if (room) {
        room.removeAllListeners();
        void room.disconnect().catch(() => undefined);
      }
      if (run !== r || e instanceof LiveCancelledError) throw new LiveCancelledError();
      // live-token says the session is no longer open: it ended while we were
      // away (ROOM_DELETED never reached us) — «انتهى المجلس», not a retry storm.
      if ((e as { code?: unknown } | null)?.code === 'not_open') {
        dispatch(r, { type: 'sessionEnded' });
        throw e;
      }
      creds = null; // the next attempt asks for a fresh token
      dispatch(r, { type: 'connectError' });
      if (r.conn.phase === 'failed') throw e instanceof Error ? e : new Error(String(e));
      await delay(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(r.conn.attempts - 1, 4)));
    }
  }
}

/**
 * Join the room. Resolves once connected; rejects after the 3rd failed attempt
 * (the sink has already received `conn: 'failed'`) or with LiveCancelledError
 * when {@link disconnectLive} ran meanwhile. Any previous room is left first.
 */
export async function connectLive(params: LiveConnectParams, sink: LiveSink): Promise<void> {
  await disconnectLive();
  ensureLiveKit();
  const r: Run = {
    sink,
    params,
    room: null,
    conn: { ...initialConnState, online: onlineManager.isOnline() },
    lastConn: 'idle',
    lastHostPresent: false,
    people: {},
    speakers: [],
    peopleTimer: null,
    hostTimer: null,
    onlineWaiters: [],
    offNetwork: () => undefined,
    rejoining: false,
  };
  run = r;
  paused = params.isPaused?.() ?? false;
  r.offNetwork = onlineManager.subscribe((online) => {
    if (run !== r) return;
    dispatch(r, { type: 'network', online });
    if (online) releaseWaiters(r);
  });
  await connectLoop(r, { url: params.url, token: params.token }, false);
}

/** Leave the room (no events reach the sink afterwards). Safe to call any time. */
export async function disconnectLive(): Promise<void> {
  const r = run;
  run = null;
  paused = false;
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
      await room.disconnect();
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
  if (run) dispatch(run, { type: 'sessionEnded' });
}

// ─── P4 (speaking & moderation) — NOT IMPLEMENTED in P3 ─────────────────────────

/**
 * TODO(P4): raise hand — `localParticipant.setAttributes({ h: '1' })`
 * (client rate limit ≤ 1 toggle / 5 s, §10; honour room metadata allowRequests).
 */
export async function requestToSpeak(): Promise<void> {
  throw new Error('requestToSpeak: P4 — not implemented');
}

/** TODO(P4): lower hand — `localParticipant.setAttributes({ h: '0' })`. */
export async function cancelRequestToSpeak(): Promise<void> {
  throw new Error('cancelRequestToSpeak: P4 — not implemented');
}

/**
 * TODO(P4): open/close my mic once approved (decision 6) —
 * `localParticipant.setMicrophoneEnabled(on)`; switch Android to the
 * `communication` preset + FOREGROUND_SERVICE_MICROPHONE (iOS switches to
 * playAndRecord by itself via IOS_AUDIO_POLICY.recording).
 */
export async function setMicEnabled(_on: boolean): Promise<void> {
  throw new Error('setMicEnabled: P4 — not implemented');
}
