/**
 * «البث المباشر» — the live-session store (V23 P3, PLAN_LIVE_V23 §7.2–§7.5).
 *
 * One live at a time. `join()` closes the lecture player (its position is
 * saved; never resumed on leave — stop(), not pause(), so its lock-screen /
 * headset controls can't restart it on top of the live), and starting a
 * lecture while in a live leaves the live (onBeforeLecturePlay). It fetches a
 * LiveKit token (src/api/live.ts), starts the Android foreground service
 * (modules/live-foreground — «مباشر الآن» + «مغادرة»), sets the LISTENING
 * audio session and connects through src/lib/liveClient.ts (which pushes
 * batched room patches back here). `leave()` undoes all
 * of it and clears the store.
 *
 * P4: hands, the mic and every moderation step go through live-control (the
 * server sets permissions + attributes); role changes arriving from the room
 * become one-shot `notice`s. The host enters through `openGreen()` with the
 * SPEAKING audio profile and a mic-type foreground service.
 *
 * Persisted: `preferredIdentity` only (a sister's «باسمي» / «بدون اسم», per device).
 * Staff real names (D2) never come through here — useLiveStaffParticipants.
 *
 * The room follows the signed-in user: useAuth reports every change of the
 * current user id (followAuthUser), and a room joined under another auth user
 * is re-joined as the new one.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  fetchLiveToken,
  liveControl,
  LiveControlError,
  LiveTokenError,
  type LiveSessionPublic,
  type LiveToken,
  type LiveTokenErrorCode,
} from "@/api/live";
import type { LiveCommentsMessage } from "@/api/liveComments";
import { queryKeys } from "@/constants/queryKeys";
import {
  onBeforeLecturePlay,
  stop as stopLecture,
} from "@/lib/audioController";
import {
  configureListeningAudio,
  configureSpeakingAudio,
  connectLive,
  disconnectLive,
  getMicLevel,
  markSessionEnded,
  MicPermissionError,
  releaseMic,
  requestMicPermission,
  sendLiveReaction,
  setLivePaused,
  setMicEnabled,
  stopLiveAudio,
  type LiveSink,
} from "@/lib/liveClient";
import type { LiveConn, LivePerson } from "@/lib/liveConnection";
import { queryClient } from "@/lib/queryClient";
import { acceptReaction, canSendReaction, type ReactionKey } from "@/lib/liveReactions";
import {
  onLiveForegroundLeave,
  startLiveForeground,
  stopLiveForeground,
} from "../../modules/live-foreground";

export type { LiveConn, LivePerson } from "@/lib/liveConnection";

/**
 * One-shot room messages (P4, PLAN §15 room.*). The room shows the latest one
 * (a quiet banner, ~6 s) and calls clearNotice(); `id` changes on every new one.
 *   joined          «اللهم اغفر للقائمين على هذا الأمر ولوالديهم» (owner 2026-09-30: on entering)
 *   hand_raised     «رفعت يدك. يراها المشرفون في مكانك من الحلقة»
 *   accepted        «صرت من المتحدثين. افتح الميكروفون وأغلقه متى شئت. المجلس يُسجَّل وصوتك ضمنه»
 *   rejected        «اعتذر المشرف عن قبول طلب التحدث الآن»
 *   muted           «أغلق المشرف ميكروفونك، وتستطيع فتحه متى احتجت»
 *   demoted         «أعادك المشرف إلى الاستماع. ارفع يدك من جديد إن أردت التحدث»
 *   requests_closed «لا يستقبل المشرفون طلبات التحدث الآن»
 *   rate_limited    «انتظر قليلاً ثم حاول مجدداً»
 *   mic_denied      «اسمح للتطبيق باستخدام الميكروفون لتتحدث»
 *   failed          «تعذّر تنفيذ الطلب. حاول مرة أخرى»
 */
export type LiveNoticeKind =
  | "joined"
  | "hand_raised"
  | "accepted"
  | "rejected"
  | "muted"
  | "demoted"
  | "requests_closed"
  | "rate_limited"
  | "mic_denied"
  | "failed";
export interface LiveNotice {
  kind: LiveNoticeKind;
  id: number;
}

/**
 * Moderator actions on another participant (live-control; staff only — D1).
 * react_block / react_unblock (0157): stop / allow that person's reactions.
 */
export type LiveModerationAction =
  | "approve"
  | "reject"
  | "mute"
  | "demote"
  | "react_block"
  | "react_unblock";

/** sendReaction's outcome (the room shows a short line for the refusals). */
export type ReactionSendResult = "sent" | "cooldown" | "blocked" | "unavailable";

export interface LiveState {
  session: LiveSessionPublic | null;
  conn: LiveConn;
  me: {
    identity: string;
    role: LivePerson["role"];
    hidden: boolean;
    gender: "m" | "f";
  } | null;
  people: Record<string, LivePerson>;
  /** Identities, loudest first. */
  activeSpeakers: string[];
  counts: { brothers: number; sisters: number };
  hostPresent: boolean;
  /** Local listen-pause (the room stays connected). */
  paused: boolean;
  /** Persisted per device; sisters' last choice, changeable in «في الحلقة». */
  preferredIdentity: "named" | "hidden" | null;
  lastError: LiveTokenErrorCode | null;

  // ─── P4: speaking & moderation ───
  notice: LiveNotice | null;
  /** My microphone is published and unmuted. */
  micOn: boolean;
  /** raiseHand/lowerHand in flight (disable «طلب التحدث» meanwhile). */
  handBusy: boolean;
  /** setMic in flight. */
  micBusy: boolean;
  /** Room metadata «استقبال طلبات التحدث» (moderators switch it). */
  allowRequests: boolean;

  /** Throws LiveTokenError (e.g. 'gender_required' → show GenderPrompt, then call join again). */
  join(
    session: LiveSessionPublic,
    opts?: { identityChoice?: "named" | "hidden" },
  ): Promise<void>;
  leave(): Promise<void>;
  setPaused(p: boolean): void;
  setPreferredIdentity(c: "named" | "hidden"): void;

  /** Registered listener → live-control `hand` {up:true}. Never throws; outcome → `notice`. */
  raiseHand(): Promise<void>;
  /** Cancel my request («بانتظار الإذن · إلغاء»). Never throws. */
  lowerHand(): Promise<void>;
  /** Speaker / moderator / host: open/close my mic (asks the OS permission first). Never throws; failures → `notice`. */
  setMic(on: boolean): Promise<void>;
  /** A speaker returns himself to listening (D1). Never throws. */
  stepDown(): Promise<void>;
  /** Moderators. Throws LiveControlError (code: forbidden | invalid_target | not_present | guest_cannot_speak | network …). */
  moderate(action: LiveModerationAction, identity: string): Promise<void>;
  /** Moderators: «استقبال طلبات التحدث». Throws LiveControlError. */
  setAllowRequests(allow: boolean): Promise<void>;
  /**
   * Send a reaction (0157) — LiveKit data only, never the DB. Rate-limited per
   * device; mine shows at once (LiveKit doesn't echo to the sender). Never throws.
   */
  sendReaction(key: ReactionKey): Promise<ReactionSendResult>;
  /** Host: hand the session to a moderator present (host_leave), then leave the room. Throws LiveControlError. */
  handOver(identity: string): Promise<void>;
  /** Host / content manager: end for everyone (call AFTER the 5 s undo). The room then shows «انتهى المجلس». Throws LiveControlError. */
  endForAll(): Promise<void>;
  /**
   * Host green room: open_green when still `scheduled`, then join with the mic
   * ON (meter + connection check). Throws LiveTokenError / LiveControlError.
   */
  openGreen(session: LiveSessionPublic): Promise<void>;
  /** Green → live (live-control start; recording begins). Updates `session.status`. Throws LiveControlError. */
  startBroadcast(): Promise<void>;
  clearNotice(): void;
}

type RuntimeFields = Pick<
  LiveState,
  | "session"
  | "conn"
  | "me"
  | "people"
  | "activeSpeakers"
  | "counts"
  | "hostPresent"
  | "paused"
  | "lastError"
  | "notice"
  | "micOn"
  | "handBusy"
  | "micBusy"
  | "allowRequests"
>;

function runtimeReset(): RuntimeFields {
  return {
    session: null,
    conn: "idle",
    me: null,
    people: {},
    activeSpeakers: [],
    counts: { brothers: 0, sisters: 0 },
    hostPresent: false,
    paused: false,
    lastError: null,
    notice: null,
    micOn: false,
    handBusy: false,
    micBusy: false,
    allowRequests: true,
  };
}

/** Conns in which the store is in (or getting into) the room — a second join() is a no-op. */
const IN_ROOM: ReadonlySet<LiveConn> = new Set<LiveConn>([
  "connecting",
  "ok",
  "poor",
  "reconnecting",
  "hostdrop",
  "offline",
]);

/** Bumped by every join/leave; a join that finds it changed after an await was superseded. */
let joinGen = 0;
let offForegroundLeave: (() => void) | null = null;
let foregroundOn = false;
/** The running service has the microphone type (Android 14: required to capture with the screen off). */
let foregroundMic = false;
let noticeSeq = 0;
/** Until when a speaker→listener change is my own step-down (no «أعادك المشرف» notice). */
let steppingDownUntil = 0;
let steppingDown = false;
/** The signed-in auth user as last reported by useAuth (followAuthUser); null before the first report. */
let authUserId: string | null = null;
/** The auth user the current room connection was made for: set as a join starts, cleared by leave(). */
let joinedAs: string | null = null;

const getState = () => useLiveStore.getState();
const setState = (p: Partial<LiveState>) => useLiveStore.setState(p);

/** «التعليقات والأسئلة» (0147): the room's comment updates, for useLiveComments. */
export type LiveCommentsListener = (sessionId: string, msg: LiveCommentsMessage) => void;
const commentsListeners = new Set<LiveCommentsListener>();

/**
 * Subscribe to the comment stream of the room I'm in (LiveKit topic
 * "comments", already parsed). Not kept in the store: the list lives in the
 * TanStack cache (src/hooks/useLiveComments.ts). Returns the unsubscribe.
 */
export function onLiveComments(listener: LiveCommentsListener): () => void {
  commentsListeners.add(listener);
  return () => {
    commentsListeners.delete(listener);
  };
}

/** Reactions «التفاعل» (0157): a flying sign for the overlay. Not kept in the store. */
export type LiveReactionEvent = { key: ReactionKey; identity: string; mine: boolean };
export type LiveReactionListener = (e: LiveReactionEvent) => void;
const reactionListeners = new Set<LiveReactionListener>();
/** Receiver-side spam guard: last accepted reaction per sender identity. */
const lastReactionBy = new Map<string, number>();
let lastReactionSentAt: number | null = null;

/** Subscribe to the reactions of the room I'm in. Returns the unsubscribe. */
export function onLiveReaction(listener: LiveReactionListener): () => void {
  reactionListeners.add(listener);
  return () => {
    reactionListeners.delete(listener);
  };
}

function emitReaction(e: LiveReactionEvent) {
  for (const l of Array.from(reactionListeners)) {
    try {
      l(e);
    } catch {
      /* one listener's failure never stops the room */
    }
  }
}

function emitComments(msg: LiveCommentsMessage) {
  const sessionId = getState().session?.id;
  if (!sessionId) return;
  for (const l of Array.from(commentsListeners)) {
    try {
      l(sessionId, msg);
    } catch {
      /* one listener's failure never stops the room */
    }
  }
}

/** Foreground service → room → audio session. Idempotent. */
async function releaseResources(): Promise<void> {
  // Unsubscribe the «مغادرة» action first, then stop the service.
  if (offForegroundLeave) {
    const off = offForegroundLeave;
    offForegroundLeave = null;
    try {
      off();
    } catch {
      /* ignored */
    }
  }
  if (foregroundOn) {
    foregroundOn = false;
    foregroundMic = false;
    try {
      stopLiveForeground();
    } catch {
      /* ignored */
    }
  }
  await disconnectLive().catch(() => undefined);
  await stopLiveAudio().catch(() => undefined);
}

/**
 * Start (or re-type) the foreground service. `withMic` adds the microphone
 * type — only after the RECORD_AUDIO grant, and only from the foreground (a
 * user tap), as Android 14 requires.
 */
function startForeground(session: LiveSessionPublic, withMic = false) {
  try {
    startLiveForeground({
      title: "مباشر الآن · " + session.title,
      text: session.sheikhName ? "مع " + session.sheikhName : "",
      url: "riwaqalilm://live/" + session.id,
      withMic,
    });
    foregroundOn = true;
    foregroundMic = withMic;
    if (!offForegroundLeave) {
      offForegroundLeave = onLiveForegroundLeave(() => {
        void getState().leave();
      });
    }
  } catch {
    // Non-fatal: the live still plays while the app is in the foreground.
  }
}

function setForegroundMic(on: boolean) {
  const s = getState().session;
  if (!foregroundOn || !s || foregroundMic === on) return;
  startForeground(s, on);
}

function notify(kind: LiveNoticeKind) {
  setState({ notice: { kind, id: ++noticeSeq } });
}

/** live-control refusal → the notice a listener sees. */
function controlNotice(e: unknown): LiveNoticeKind {
  const code = e instanceof LiveControlError ? e.code : "";
  if (code === "requests_closed") return "requests_closed";
  if (code === "rate_limited") return "rate_limited";
  return "failed";
}

/** Waits before the 2nd and 3rd token try — a weak network's lost request is not a refusal. */
export const TOKEN_RETRY_DELAYS_MS = [1500, 4000] as const;

/**
 * live-token with two quiet retries on a NETWORK failure only (a refusal —
 * gender_required, not_open, banned… — is final at once). Stops retrying when
 * the join was superseded.
 */
async function fetchTokenPatiently(
  sessionId: string,
  choice: "named" | "hidden" | undefined,
  stillWanted: () => boolean,
): Promise<LiveToken> {
  for (let i = 0; ; i++) {
    try {
      return await fetchLiveToken(sessionId, choice);
    } catch (e) {
      const network = e instanceof LiveTokenError && e.code === "network";
      if (!network || i >= TOKEN_RETRY_DELAYS_MS.length || !stillWanted())
        throw e;
      await new Promise((r) => setTimeout(r, TOKEN_RETRY_DELAYS_MS[i]));
      if (!stillWanted()) throw e;
    }
  }
}

/** Room patches from liveClient, dropped once this join was superseded. */
function makeSink(gen: number): LiveSink {
  return {
    patch(p) {
      if (gen !== joinGen) return;
      const next: Partial<LiveState> = { ...p };
      let became: LivePerson["role"] | null = null;
      let was: LivePerson["role"] | null = null;
      if (p.people) {
        // My role/visibility can change in the room (approve/demote/host_leave → r, server-set).
        const me = getState().me;
        const mine = me ? p.people[me.identity] : undefined;
        if (
          me &&
          mine &&
          (mine.role !== me.role || mine.hidden !== me.hidden)
        ) {
          next.me = { ...me, role: mine.role, hidden: mine.hidden };
          if (mine.role !== me.role) {
            was = me.role;
            became = mine.role;
          }
        }
      }
      if (p.conn === "failed") next.lastError = "network";
      setState(next);
      if (was === "listener" && became === "speaker") {
        notify("accepted");
        // Invited without raising a hand: ask for the mic now, while it is
        // still closed, so «افتح الميكروفون» later never hits the OS dialog.
        void requestMicPermission().catch(() => undefined);
      }
      if (was === "speaker" && became === "listener") {
        if (Date.now() < steppingDownUntil) steppingDownUntil = 0;
        else notify("demoted");
      }
      if (p.conn === "ended" || p.conn === "failed") void releaseResources();
    },
    event(e) {
      if (gen !== joinGen) return;
      if (e.type === "rejected") notify("rejected");
      else if (e.type === "mutedByModerator") notify("muted");
      else if (e.type === "publishRevoked") setForegroundMic(false);
      else if (e.type === "comments") emitComments(e.msg);
      else if (e.type === "reaction") {
        if (acceptReaction(lastReactionBy, e.identity, Date.now())) {
          emitReaction({ key: e.key, identity: e.identity, mine: false });
        }
      }
    },
  };
}

function sendLeave(sessionId: string) {
  void liveControl("leave", { sessionId }).catch(() => undefined);
}

/**
 * `speaking` (the host's green room, mic permission already granted): the
 * SPEAKING audio profile + a mic-type foreground service from the start, so
 * the first mic open needs no session restart.
 */
async function startJoin(
  session: LiveSessionPublic,
  choiceOverride?: "named" | "hidden",
  opts?: { speaking?: boolean },
): Promise<void> {
  const speaking = opts?.speaking === true;
  const my = ++joinGen;
  // Synchronously, before any await: followAuthUser compares against it.
  joinedAs = authUserId;
  const prev = getState();
  // A real entry (not a sister's «باسمي» ⇄ «بدون اسم» re-join of the same room)
  // greets with the du'a once connected. Not in the host's green room.
  const entering =
    !speaking && !(prev.session?.id === session.id && IN_ROOM.has(prev.conn));
  if (prev.session) {
    // Switching sessions (or retrying / re-joining this one): drop the old room first.
    if (prev.session.id !== session.id && prev.me) sendLeave(prev.session.id);
    await releaseResources();
    if (my !== joinGen) return;
  }
  if (choiceOverride) setState({ preferredIdentity: choiceOverride });
  const choice = choiceOverride ?? getState().preferredIdentity ?? undefined;

  setState({ ...runtimeReset(), session, conn: "connecting" });
  // A live owns the audio: close the lecture (never auto-resumed on leave).
  try {
    stopLecture();
  } catch {
    /* no lecture loaded */
  }

  let token: LiveToken;
  try {
    token = await fetchTokenPatiently(session.id, choice, () => my === joinGen);
  } catch (e) {
    const err = e instanceof LiveTokenError ? e : new LiveTokenError("unknown");
    if (my === joinGen) {
      setState(
        err.code === "gender_required"
          ? // Nothing to show while GenderPrompt is up (no mini-bar); join() is retried after.
            { ...runtimeReset(), lastError: err.code }
          : { conn: "failed", lastError: err.code },
      );
    }
    throw err;
  }
  if (my !== joinGen) return;
  setState({
    me: {
      identity: token.identity,
      role: token.role,
      hidden: token.hidden,
      gender: token.gender,
    },
  });
  // Start the foreground service NOW, still inside the tap's foreground window:
  // connecting can outlast Android 12+'s start-from-background grace (retries,
  // 15 s timeouts), and a screen locked meanwhile would otherwise leave the
  // whole session without a service — audio dies with the screen off.
  // releaseResources() stops it if the connect fails.
  startForeground(session, speaking);

  try {
    await (speaking ? configureSpeakingAudio() : configureListeningAudio());
    if (my !== joinGen) {
      await stopLiveAudio().catch(() => undefined);
      return;
    }
    await connectLive(
      {
        url: token.url,
        token: token.token,
        refresh: async () => {
          const t = await fetchLiveToken(
            session.id,
            getState().preferredIdentity ?? undefined,
          );
          return { url: t.url, token: t.token };
        },
        isPaused: () => getState().paused,
      },
      makeSink(my),
    );
  } catch {
    if (my !== joinGen) return; // left / re-joined meanwhile
    if (getState().conn === "ended") return; // the session ended while connecting
    await releaseResources();
    if (my === joinGen) setState({ conn: "failed", lastError: "network" });
    throw new LiveTokenError("network");
  }
  if (my === joinGen && entering && getState().conn !== "ended") notify("joined");
  if (
    my === joinGen &&
    !speaking &&
    token.role === "host" &&
    session.status === "live"
  ) {
    // The sheikh re-entering his own live (app restarted): until his mic is
    // back every listener sees «انقطع اتصال الشيخ مؤقتاً».
    void getState().setMic(true);
  }
}

export const useLiveStore = create<LiveState>()(
  persist(
    (set, get) => ({
      ...runtimeReset(),
      preferredIdentity: null,

      join: async (session, opts) => {
        const cur = get();
        const c = opts?.identityChoice;
        if (cur.session?.id === session.id && IN_ROOM.has(cur.conn)) {
          // Already in (or entering) this room — only a sister's changed choice re-joins.
          const changes =
            !!c && cur.me?.gender === "f" && cur.me.hidden !== (c === "hidden");
          if (!changes) {
            if (c) set({ preferredIdentity: c });
            return;
          }
        }
        await startJoin(session, c);
      },

      leave: async () => {
        const { session, me } = get();
        joinGen++;
        joinedAs = null;
        set(runtimeReset());
        await releaseResources();
        if (session && me) sendLeave(session.id);
      },

      setPaused: (p) => {
        set({ paused: p });
        setLivePaused(p);
      },

      setPreferredIdentity: (c) => {
        set({ preferredIdentity: c });
        const { session, me, conn } = get();
        // A sister changing «باسمي» ⇄ «بدون اسم» inside the room: the name is in
        // the token, so re-join with the new choice.
        if (
          session &&
          me &&
          me.gender === "f" &&
          me.hidden !== (c === "hidden") &&
          IN_ROOM.has(conn)
        ) {
          void startJoin(session, c).catch(() => undefined);
        }
      },

      // ─── P4 ───
      raiseHand: async () => {
        const { session, me, handBusy } = get();
        if (!session || !me || handBusy) return;
        set({ handBusy: true });
        try {
          // Ask for the microphone NOW, while only listening: the OS dialog
          // pauses JS and the room reconnects right after it — harmless here,
          // but it would break a mic publish started at that instant. Once
          // approved, «افتح الميكروفون» is then instant, with no dialog.
          try {
            await requestMicPermission();
          } catch {
            notify("mic_denied");
            return;
          }
          await liveControl("hand", { sessionId: session.id, up: true });
          notify("hand_raised");
        } catch (e) {
          notify(controlNotice(e));
        } finally {
          set({ handBusy: false });
        }
      },

      lowerHand: async () => {
        const { session, me, handBusy } = get();
        if (!session || !me || handBusy) return;
        set({ handBusy: true });
        try {
          await liveControl("hand", { sessionId: session.id, up: false });
        } catch (e) {
          notify(controlNotice(e));
        } finally {
          set({ handBusy: false });
        }
      },

      setMic: async (on) => {
        const { session, micBusy } = get();
        if (!session || micBusy) return;
        set({ micBusy: true });
        try {
          await setMicEnabled(on);
          if (on) setForegroundMic(true);
        } catch (e) {
          notify(e instanceof MicPermissionError ? "mic_denied" : "failed");
        } finally {
          set({ micBusy: false });
        }
      },

      stepDown: async () => {
        const { session, me } = get();
        if (!session || !me || me.role !== "speaker" || steppingDown) return;
        steppingDown = true;
        steppingDownUntil = Date.now() + 15_000;
        try {
          await releaseMic();
          setForegroundMic(false);
          await liveControl("demote", {
            sessionId: session.id,
            identity: me.identity,
          });
        } catch (e) {
          // invalid_target = already a listener; a lost response may still have
          // demoted me — keep the window so neither shows «أعادك المشرف».
          const code = e instanceof LiveControlError ? e.code : "";
          if (code !== "invalid_target" && code !== "network") {
            steppingDownUntil = 0;
            notify("failed");
          }
        } finally {
          steppingDown = false;
        }
      },

      moderate: async (action, identity) => {
        const { session } = get();
        if (!session) throw new LiveControlError("not_present");
        if (action === "react_block" || action === "react_unblock") {
          await liveControl("react_block", {
            sessionId: session.id,
            identity,
            blocked: action === "react_block",
          });
          return;
        }
        await liveControl(action, { sessionId: session.id, identity });
      },

      sendReaction: async (key) => {
        const { me, people, conn } = get();
        if (!me || (conn !== "ok" && conn !== "poor" && conn !== "hostdrop")) return "unavailable";
        if (people[me.identity]?.reactBlocked) return "blocked";
        const now = Date.now();
        if (!canSendReaction(lastReactionSentAt, now)) return "cooldown";
        lastReactionSentAt = now;
        const sent = await sendLiveReaction(key);
        if (!sent) return people[me.identity]?.reactBlocked ? "blocked" : "unavailable";
        emitReaction({ key, identity: me.identity, mine: true });
        return "sent";
      },

      setAllowRequests: async (allow) => {
        const { session } = get();
        if (!session) throw new LiveControlError("not_present");
        await liveControl("set_allow_requests", {
          sessionId: session.id,
          allow,
        });
        set({ allowRequests: allow });
      },

      handOver: async (identity) => {
        const { session } = get();
        if (!session) throw new LiveControlError("not_present");
        await liveControl("host_leave", { sessionId: session.id, identity });
        await get().leave();
      },

      endForAll: async () => {
        const { session } = get();
        if (!session) throw new LiveControlError("not_present");
        await liveControl("end", { sessionId: session.id });
        // ROOM_DELETED normally ends the room; don't wait for it.
        endedHere(session.id);
      },

      openGreen: async (session) => {
        // leave() (the green room closing) bumps joinGen: every await below
        // re-checks it, so a room swiped away mid-open never ends up with a
        // live mic behind another screen.
        const gen = joinGen;
        const cancelled = () => joinGen !== gen;
        let s = session;
        if (s.status === "scheduled") {
          const res = await liveControl("open_green", { sessionId: s.id });
          if (cancelled()) return;
          s = { ...s, status: res.status ?? "green" };
        }
        // The grant must exist BEFORE a microphone-type foreground service starts.
        let micOk = true;
        try {
          await requestMicPermission();
        } catch {
          micOk = false;
        }
        if (cancelled()) return;
        await startJoin(s, undefined, { speaking: micOk });
        const joined = joinGen;
        if (joined !== gen + 1 || get().session?.id !== s.id) return;
        if (micOk) await get().setMic(true);
        else notify("mic_denied");
      },

      startBroadcast: async () => {
        const { session } = get();
        if (!session) throw new LiveControlError("not_present");
        const res = await liveControl("start", { sessionId: session.id });
        const cur = get().session;
        if (cur?.id === session.id) {
          set({
            session: {
              ...cur,
              status: res.status ?? "live",
              startedAt: cur.startedAt ?? new Date().toISOString(),
            },
          });
        }
      },

      clearNotice: () => set({ notice: null }),
    }),
    {
      name: "riwaq-live",
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ preferredIdentity: s.preferredIdentity }),
    },
  ),
);

// A lecture starting (tap, auto-advance, lock-screen / headset play) while in a
// live leaves the live — one audio owner at a time.
onBeforeLecturePlay(() => {
  if (getState().session) void getState().leave();
});

/**
 * The signed-in user is now `userId` (useAuth reports every change of the
 * current user). A room joined under ANOTHER auth user must not stay on that
 * identity — a guest in the majlis who signed in as the sheikh still showed
 * «طلب التحدث» and «أنت» as a listener (device report 2026-09-30). It drops the
 * old connection and re-joins the SAME session with a token for the new user
 * (host / moderator / listener, whatever live-token now says) — without the
 * intermediate `session: null` of leave(), which would close an open room
 * screen and flash the mini-bar, and without live-control `leave`: the JWT is
 * already the new user's, so it could only close HIS row; the old identity's
 * row is closed by LiveKit's participant_left on disconnect (0138
 * live_room_event). A refused re-join (gender_required, banned, not_open…)
 * lands in the store like any join failure; never thrown.
 *
 * No-op for the same user (register links the guest in place — same id), with
 * no room, or once already re-joining for this user (joinedAs is updated
 * synchronously, so repeated reports act once). Sign-out never gets here with
 * a room: it leaves before the session switches.
 */
export async function followAuthUser(userId: string): Promise<void> {
  authUserId = userId;
  const { session, conn } = getState();
  if (!session || !IN_ROOM.has(conn) || joinedAs === null || joinedAs === userId) return;
  await startJoin(session).catch(() => undefined);
}

/** Green-room meter: my microphone's current level 0..1 (poll ≈ 6×/s; 0 when no mic). */
export function getLiveMicLevel(): number {
  return getState().micOn ? getMicLevel() : 0;
}

/**
 * The session row reached an over status (ended/processing/ready/failed/
 * cancelled) — called by useLiveSession's poll. Ends the room even if the
 * ROOM_DELETED disconnect never arrived (e.g. while offline).
 */
/**
 * This device just ended the session — the room's «إنهاء البث للجميع» or the
 * staff card's («البث المباشر»). The room ends NOW: a join still connecting is
 * cancelled and the open screen reads «انتهى المجلس» from the cached status,
 * without waiting for LiveKit's ROOM_DELETED (a join still connecting never
 * gets it) or the next session poll. Owner 2026-10-05 «احاول انهاء البث,
 * معلق»: the room sat on «جارٍ الانضمام» ~95 s after an end from this phone.
 */
export function endedHere(sessionId: string): void {
  queryClient.setQueryData<LiveSessionPublic | null>(queryKeys.liveSession(sessionId), (old) =>
    old && (old.status === "live" || old.status === "green" || old.status === "scheduled")
      ? { ...old, status: "ended", endedAt: old.endedAt ?? new Date().toISOString() }
      : old,
  );
  notifyLiveSessionEnded(sessionId);
}

export function notifyLiveSessionEnded(sessionId: string): void {
  const s = getState();
  if (s.session?.id !== sessionId || s.conn === "ended" || s.conn === "idle")
    return;
  markSessionEnded();
  if (getState().conn !== "ended") {
    // No live room to route it through (failed / between re-joins).
    joinGen++;
    setState({ conn: "ended" });
    void releaseResources();
  }
}
