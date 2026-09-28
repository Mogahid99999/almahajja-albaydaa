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
 * Persisted: `preferredIdentity` only (a sister's «باسمي» / «بدون اسم», per device).
 * Staff real names (D2) never come through here — useLiveStaffParticipants.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  fetchLiveToken,
  liveControl,
  LiveTokenError,
  type LiveSessionPublic,
  type LiveToken,
  type LiveTokenErrorCode,
} from '@/api/live';
import { onBeforeLecturePlay, stop as stopLecture } from '@/lib/audioController';
import {
  configureListeningAudio,
  connectLive,
  disconnectLive,
  markSessionEnded,
  setLivePaused,
  stopLiveAudio,
  type LiveSink,
} from '@/lib/liveClient';
import type { LiveConn, LivePerson } from '@/lib/liveConnection';
import {
  onLiveForegroundLeave,
  startLiveForeground,
  stopLiveForeground,
} from '../../modules/live-foreground';

export type { LiveConn, LivePerson } from '@/lib/liveConnection';

export interface LiveState {
  session: LiveSessionPublic | null;
  conn: LiveConn;
  me: { identity: string; role: LivePerson['role']; hidden: boolean; gender: 'm' | 'f' } | null;
  people: Record<string, LivePerson>;
  /** Identities, loudest first. */
  activeSpeakers: string[];
  counts: { brothers: number; sisters: number };
  hostPresent: boolean;
  /** Local listen-pause (the room stays connected). */
  paused: boolean;
  /** Persisted per device; sisters' last choice, changeable in «في الحلقة». */
  preferredIdentity: 'named' | 'hidden' | null;
  lastError: LiveTokenErrorCode | null;
  /** Throws LiveTokenError (e.g. 'gender_required' → show GenderPrompt, then call join again). */
  join(session: LiveSessionPublic, opts?: { identityChoice?: 'named' | 'hidden' }): Promise<void>;
  leave(): Promise<void>;
  setPaused(p: boolean): void;
  setPreferredIdentity(c: 'named' | 'hidden'): void;
}

type RuntimeFields = Pick<
  LiveState,
  'session' | 'conn' | 'me' | 'people' | 'activeSpeakers' | 'counts' | 'hostPresent' | 'paused' | 'lastError'
>;

function runtimeReset(): RuntimeFields {
  return {
    session: null,
    conn: 'idle',
    me: null,
    people: {},
    activeSpeakers: [],
    counts: { brothers: 0, sisters: 0 },
    hostPresent: false,
    paused: false,
    lastError: null,
  };
}

/** Conns in which the store is in (or getting into) the room — a second join() is a no-op. */
const IN_ROOM: ReadonlySet<LiveConn> = new Set<LiveConn>([
  'connecting',
  'ok',
  'poor',
  'reconnecting',
  'hostdrop',
  'offline',
]);

/** Bumped by every join/leave; a join that finds it changed after an await was superseded. */
let joinGen = 0;
let offForegroundLeave: (() => void) | null = null;
let foregroundOn = false;

const getState = () => useLiveStore.getState();
const setState = (p: Partial<LiveState>) => useLiveStore.setState(p);

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
    try {
      stopLiveForeground();
    } catch {
      /* ignored */
    }
  }
  await disconnectLive().catch(() => undefined);
  await stopLiveAudio().catch(() => undefined);
}

function startForeground(session: LiveSessionPublic) {
  try {
    startLiveForeground({
      title: 'مباشر الآن · ' + session.title,
      text: session.sheikhName ? 'مع ' + session.sheikhName : '',
      url: 'riwaqalilm://live/' + session.id,
    });
    foregroundOn = true;
    offForegroundLeave = onLiveForegroundLeave(() => {
      void getState().leave();
    });
  } catch {
    // Non-fatal: the live still plays while the app is in the foreground.
  }
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
  choice: 'named' | 'hidden' | undefined,
  stillWanted: () => boolean,
): Promise<LiveToken> {
  for (let i = 0; ; i++) {
    try {
      return await fetchLiveToken(sessionId, choice);
    } catch (e) {
      const network = e instanceof LiveTokenError && e.code === 'network';
      if (!network || i >= TOKEN_RETRY_DELAYS_MS.length || !stillWanted()) throw e;
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
      if (p.people) {
        // My role/visibility can change in the room (P4 approve/demote → r).
        const me = getState().me;
        const mine = me ? p.people[me.identity] : undefined;
        if (me && mine && (mine.role !== me.role || mine.hidden !== me.hidden)) {
          next.me = { ...me, role: mine.role, hidden: mine.hidden };
        }
      }
      if (p.conn === 'failed') next.lastError = 'network';
      setState(next);
      if (p.conn === 'ended' || p.conn === 'failed') void releaseResources();
    },
  };
}

function sendLeave(sessionId: string) {
  void liveControl('leave', { sessionId }).catch(() => undefined);
}

async function startJoin(session: LiveSessionPublic, choiceOverride?: 'named' | 'hidden'): Promise<void> {
  const my = ++joinGen;
  const prev = getState();
  if (prev.session) {
    // Switching sessions (or retrying / re-joining this one): drop the old room first.
    if (prev.session.id !== session.id && prev.me) sendLeave(prev.session.id);
    await releaseResources();
    if (my !== joinGen) return;
  }
  if (choiceOverride) setState({ preferredIdentity: choiceOverride });
  const choice = choiceOverride ?? getState().preferredIdentity ?? undefined;

  setState({ ...runtimeReset(), session, conn: 'connecting' });
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
    const err = e instanceof LiveTokenError ? e : new LiveTokenError('unknown');
    if (my === joinGen) {
      setState(
        err.code === 'gender_required'
          ? // Nothing to show while GenderPrompt is up (no mini-bar); join() is retried after.
            { ...runtimeReset(), lastError: err.code }
          : { conn: 'failed', lastError: err.code },
      );
    }
    throw err;
  }
  if (my !== joinGen) return;
  setState({
    me: { identity: token.identity, role: token.role, hidden: token.hidden, gender: token.gender },
  });
  // Start the foreground service NOW, still inside the tap's foreground window:
  // connecting can outlast Android 12+'s start-from-background grace (retries,
  // 15 s timeouts), and a screen locked meanwhile would otherwise leave the
  // whole session without a service — audio dies with the screen off.
  // releaseResources() stops it if the connect fails.
  startForeground(session);

  try {
    await configureListeningAudio();
    if (my !== joinGen) {
      await stopLiveAudio().catch(() => undefined);
      return;
    }
    await connectLive(
      {
        url: token.url,
        token: token.token,
        refresh: async () => {
          const t = await fetchLiveToken(session.id, getState().preferredIdentity ?? undefined);
          return { url: t.url, token: t.token };
        },
        isPaused: () => getState().paused,
      },
      makeSink(my),
    );
  } catch {
    if (my !== joinGen) return; // left / re-joined meanwhile
    if (getState().conn === 'ended') return; // the session ended while connecting
    await releaseResources();
    if (my === joinGen) setState({ conn: 'failed', lastError: 'network' });
    throw new LiveTokenError('network');
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
          const changes = !!c && cur.me?.gender === 'f' && cur.me.hidden !== (c === 'hidden');
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
        if (session && me && me.gender === 'f' && me.hidden !== (c === 'hidden') && IN_ROOM.has(conn)) {
          void startJoin(session, c).catch(() => undefined);
        }
      },
    }),
    {
      name: 'riwaq-live',
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
 * The session row reached an over status (ended/processing/ready/failed/
 * cancelled) — called by useLiveSession's poll. Ends the room even if the
 * ROOM_DELETED disconnect never arrived (e.g. while offline).
 */
export function notifyLiveSessionEnded(sessionId: string): void {
  const s = getState();
  if (s.session?.id !== sessionId || s.conn === 'ended' || s.conn === 'idle') return;
  markSessionEnded();
  if (getState().conn !== 'ended') {
    // No live room to route it through (failed / between re-joins).
    joinGen++;
    setState({ conn: 'ended' });
    void releaseResources();
  }
}
