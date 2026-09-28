/**
 * «الحلقة» (V23 P3) — the PURE part of the live client: connection-state
 * reducer (PLAN_LIVE_V23 §7.5) and participant → person mapping (§5.1
 * attributes). No LiveKit, no React, no timers: src/lib/liveClient.ts feeds
 * LiveKit events in as plain {@link ConnEvent}s and publishes {@link deriveConn}
 * to the store. Everything here is unit-tested
 * (src/lib/__tests__/liveConnection.test.ts).
 *
 * Event → state mapping (§7.5):
 *   Room.connect()                          → connecting (a re-join after a drop: reconnecting)
 *   connect resolved                        → ok
 *   ConnectionQualityChanged(poor|lost), me → poor
 *   Reconnecting / Reconnected              → reconnecting / ok
 *   host left the room, or no host
 *     microphone track for ≥ 5 s            → hostdrop
 *   network offline (expo-network via the
 *     TanStack onlineManager)               → offline
 *   3rd failed connect attempt              → failed
 *   Disconnected(ROOM_DELETED|ROOM_CLOSED)
 *     or the session row reached an
 *     ended status                          → ended
 */

export type LiveConn =
  | 'idle'
  | 'connecting'
  | 'ok'
  | 'poor'
  | 'reconnecting'
  | 'hostdrop'
  | 'offline'
  | 'failed'
  | 'ended';

export type LiveRole = 'listener' | 'speaker' | 'host' | 'moderator';
export type LiveGender = 'm' | 'f';

/** One attendee as the room UI draws them (brother/sister icon, name, hand, ripple). */
export interface LivePerson {
  identity: string;
  /** LiveKit `name`: the display name, «طالبة» for a hidden sister, «ضيف»/«ضيفة» for a guest. */
  name: string;
  gender: LiveGender;
  role: LiveRole;
  hidden: boolean;
  hand: boolean;
  speaking: boolean;
  isMe: boolean;
}

/**
 * A FIRST entry gives up after this many failed attempts (§7.5 «failed» + a
 * retry button). A re-join after a drop never gives up while the session is
 * live — on a weak network «جارٍ إعادة الاتصال…» until it gets back in (the
 * loop waits out offline spells; live-token `not_open` ends it as «انتهى»).
 */
export const MAX_CONNECT_ATTEMPTS = 3;
/** No host microphone track for this long → «انقطع اتصال الشيخ مؤقتاً» (§7.5 «hostdrop»). */
export const HOST_AUDIO_GRACE_MS = 5000;

export type ConnPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'ended';

export interface ConnState {
  phase: ConnPhase;
  /** Failed connect attempts in the current run (reset by `connected`). */
  attempts: number;
  /** Device network (onlineManager); only an explicit offline counts. */
  online: boolean;
  /** Local participant ConnectionQuality is poor/lost. */
  poor: boolean;
  /** A participant with attribute r=host is in the room. */
  hostPresent: boolean;
  /** When the host's microphone track went missing (ms); null while it is there. */
  hostAudioLostAt: number | null;
  /** Host left, or the grace above elapsed — cleared when host audio returns. */
  hostDropped: boolean;
}

export const initialConnState: ConnState = {
  phase: 'idle',
  attempts: 0,
  online: true,
  poor: false,
  hostPresent: false,
  hostAudioLostAt: null,
  hostDropped: false,
};

/**
 * Why the room disconnected, from LiveKit's DisconnectReason:
 *  ended  — the room was deleted/closed (live-control `end`, auto_end): the session is over
 *  client — we called room.disconnect() (leave)
 *  kicked — removed by the server or replaced by the same identity on another device: don't re-join
 *  lost   — anything else (signal closed, timeouts, media failure…): re-join automatically
 */
export type DisconnectKind = 'ended' | 'client' | 'kicked' | 'lost';

export type ConnEvent =
  | { type: 'connect'; rejoin?: boolean }
  | { type: 'connected' }
  | { type: 'connectError' }
  | { type: 'quality'; quality: string }
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  | { type: 'network'; online: boolean }
  | { type: 'host'; present: boolean; hasAudio: boolean; at: number }
  | { type: 'tick'; now: number }
  | { type: 'disconnected'; kind: DisconnectKind }
  | { type: 'sessionEnded' }
  | { type: 'reset' };

const isTerminal = (phase: ConnPhase) => phase === 'ended' || phase === 'failed';

/** Pure connection reducer. Terminal phases (ended/failed) only leave via `reset` or a new `connect`. */
export function connReducer(state: ConnState, ev: ConnEvent): ConnState {
  switch (ev.type) {
    case 'reset':
      return { ...initialConnState, online: state.online };

    case 'connect':
      if (state.phase === 'ended') return state;
      return {
        ...state,
        phase: ev.rejoin ? 'reconnecting' : 'connecting',
        // A fresh room view: nothing is known about quality or the host yet.
        poor: false,
        hostPresent: false,
        hostAudioLostAt: null,
        hostDropped: false,
      };

    case 'connected':
      if (state.phase === 'ended') return state;
      return { ...state, phase: 'connected', attempts: 0 };

    case 'connectError': {
      if (state.phase === 'ended') return state;
      const attempts = state.attempts + 1;
      const rejoining = state.phase === 'reconnecting';
      return {
        ...state,
        attempts,
        phase: !rejoining && attempts >= MAX_CONNECT_ATTEMPTS ? 'failed' : state.phase,
      };
    }

    case 'quality':
      return { ...state, poor: ev.quality === 'poor' || ev.quality === 'lost' };

    case 'reconnecting':
      if (isTerminal(state.phase) || state.phase === 'idle') return state;
      return { ...state, phase: 'reconnecting' };

    case 'reconnected':
      if (isTerminal(state.phase) || state.phase === 'idle') return state;
      return { ...state, phase: 'connected', poor: false };

    case 'network':
      return state.online === ev.online ? state : { ...state, online: ev.online };

    case 'host': {
      if (ev.present && ev.hasAudio) {
        return { ...state, hostPresent: true, hostAudioLostAt: null, hostDropped: false };
      }
      const hostAudioLostAt = state.hostAudioLostAt ?? ev.at;
      if (!ev.present) {
        // The host left the room: immediate (§7.5 «host participant disconnected»).
        return { ...state, hostPresent: false, hostAudioLostAt, hostDropped: true };
      }
      // Present but no microphone track yet: the grace clock runs (see `tick`).
      return { ...state, hostPresent: true, hostAudioLostAt };
    }

    case 'tick':
      if (
        state.hostAudioLostAt != null &&
        !state.hostDropped &&
        ev.now - state.hostAudioLostAt >= HOST_AUDIO_GRACE_MS
      ) {
        return { ...state, hostDropped: true };
      }
      return state;

    case 'disconnected':
      if (state.phase === 'ended') return state;
      switch (ev.kind) {
        case 'ended':
          return { ...state, phase: 'ended' };
        case 'client':
          return { ...initialConnState, online: state.online };
        case 'kicked':
          return { ...state, phase: 'failed' };
        case 'lost':
          // liveClient re-joins (fresh token) — shown as «جارٍ إعادة الاتصال…».
          return { ...state, phase: 'reconnecting', attempts: 0 };
      }
      return state;

    case 'sessionEnded':
      return { ...state, phase: 'ended' };
  }
}

/**
 * The single `liveStore.conn` value for a reducer state. Precedence:
 * ended › failed › idle › offline › connecting › reconnecting › hostdrop › poor › ok.
 */
export function deriveConn(state: ConnState): LiveConn {
  switch (state.phase) {
    case 'ended':
      return 'ended';
    case 'failed':
      return 'failed';
    case 'idle':
      return 'idle';
    default:
      break;
  }
  if (!state.online) return 'offline';
  if (state.phase === 'connecting') return 'connecting';
  if (state.phase === 'reconnecting') return 'reconnecting';
  if (state.hostDropped) return 'hostdrop';
  if (state.poor) return 'poor';
  return 'ok';
}

// LiveKit protocol DisconnectReason values (livekit_models.proto — wire-stable).
const DISCONNECT_CLIENT_INITIATED = 1;
const DISCONNECT_DUPLICATE_IDENTITY = 2;
const DISCONNECT_PARTICIPANT_REMOVED = 4;
const DISCONNECT_ROOM_DELETED = 5;
const DISCONNECT_ROOM_CLOSED = 10;

export function classifyDisconnect(reason: number | null | undefined): DisconnectKind {
  switch (reason) {
    case DISCONNECT_ROOM_DELETED:
    case DISCONNECT_ROOM_CLOSED:
      return 'ended';
    case DISCONNECT_CLIENT_INITIATED:
      return 'client';
    case DISCONNECT_DUPLICATE_IDENTITY:
    case DISCONNECT_PARTICIPANT_REMOVED:
      return 'kicked';
    default:
      return 'lost';
  }
}

// ─── People (§5.1 attributes: g gender · r role · h hand · hid hidden) ─────────

export const HIDDEN_SISTER_NAME = 'طالبة';

const ROLES: readonly LiveRole[] = ['listener', 'speaker', 'host', 'moderator'];

/** The fields of a LiveKit participant this module reads. */
export interface ParticipantLike {
  identity: string;
  name?: string | null;
  attributes?: Readonly<Record<string, string>> | null;
}

export function toLivePerson(
  p: ParticipantLike,
  opts: { isMe: boolean; speaking: boolean },
): LivePerson {
  const a = p.attributes ?? {};
  const gender: LiveGender = a.g === 'f' ? 'f' : 'm';
  const role: LiveRole = (ROLES as readonly string[]).includes(a.r ?? '') ? (a.r as LiveRole) : 'listener';
  const hidden = gender === 'f' && a.hid === '1';
  const raw = (p.name ?? '').replace(/\s+/g, ' ').trim();
  // A hidden sister is always «طالبة», whatever `name` says (D2: the real name
  // never reaches the room).
  const name = hidden ? HIDDEN_SISTER_NAME : raw || (gender === 'f' ? 'طالبة' : 'طالب');
  return {
    identity: p.identity,
    name,
    gender,
    role,
    hidden,
    hand: a.h === '1',
    speaking: opts.speaking,
    isMe: opts.isMe,
  };
}

/** Brothers vs sisters in the halaqa — the host (centre medallion) is not counted. */
export function countPeople(people: Readonly<Record<string, LivePerson>>): {
  brothers: number;
  sisters: number;
} {
  let brothers = 0;
  let sisters = 0;
  for (const id in people) {
    const p = people[id];
    if (p.role === 'host') continue;
    if (p.gender === 'f') sisters++;
    else brothers++;
  }
  return { brothers, sisters };
}

/**
 * Apply a new active-speaker list to `people`, copying ONLY the persons whose
 * `speaking` flag changes (so memoized rows of everyone else keep their
 * identity). Returns the same object when nothing changed.
 */
export function withSpeaking(
  people: Readonly<Record<string, LivePerson>>,
  speakers: readonly string[],
): Record<string, LivePerson> {
  const now = new Set(speakers);
  let next: Record<string, LivePerson> | null = null;
  for (const id in people) {
    const p = people[id];
    const speaking = now.has(id);
    if (p.speaking !== speaking) {
      next ??= { ...people };
      next[id] = { ...p, speaking };
    }
  }
  return next ?? (people as Record<string, LivePerson>);
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
