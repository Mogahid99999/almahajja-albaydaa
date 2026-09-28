/**
 * src/stores/liveStore.ts — joining / leaving «الحلقة» (V23 P3, §7.2).
 *
 * Invariants pinned here (liveClient, the foreground service and the lecture
 * player are mocked):
 *  - join pauses the lecture player BEFORE anything else, sets the listening
 *    audio session BEFORE connecting, and starts the «مباشر الآن» foreground
 *    service only once connected;
 *  - `gender_required` is surfaced as LiveTokenError so the UI can show
 *    GenderPrompt and retry — with no half-joined session left behind;
 *  - leave disconnects, releases the audio session, unsubscribes the
 *    «مغادرة» action BEFORE stopping the service, clears the store and never
 *    resumes the lecture;
 *  - a sister's identity choice is remembered (preferredIdentity).
 */
import type { LiveSessionPublic, LiveToken } from '@/api/live';
import type { LiveRoomPatch, LiveSink } from '@/lib/liveClient';

const mockConfigure = jest.fn(async () => undefined);
const mockConnect = jest.fn();
const mockDisconnect = jest.fn(async () => undefined);
const mockStopAudio = jest.fn(async () => undefined);
const mockSetPaused = jest.fn();
const mockMarkEnded = jest.fn();
jest.mock('@/lib/liveClient', () => ({
  configureListeningAudio: () => mockConfigure(),
  connectLive: (...a: unknown[]) => mockConnect(...a),
  disconnectLive: () => mockDisconnect(),
  stopLiveAudio: () => mockStopAudio(),
  setLivePaused: (p: boolean) => mockSetPaused(p),
  markSessionEnded: () => mockMarkEnded(),
}));

const mockStopLecture = jest.fn();
const mockToggleLecture = jest.fn();
const mockPlayLecture = jest.fn();
jest.mock('@/lib/audioController', () => ({
  stop: () => mockStopLecture(),
  toggle: () => mockToggleLecture(),
  playLecture: (...a: unknown[]) => mockPlayLecture(...a),
  onBeforeLecturePlay: jest.fn(),
}));

const mockFetchToken = jest.fn();
const mockLiveControl = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/api/live', () => {
  const actual = jest.requireActual('@/api/live');
  return {
    ...actual,
    fetchLiveToken: (...a: unknown[]) => mockFetchToken(...a),
    liveControl: (...a: unknown[]) => mockLiveControl(...a),
  };
});

const mockStartFg = jest.fn();
const mockStopFg = jest.fn();
const mockOffLeave = jest.fn();
let mockLeaveAction: (() => void) | null = null;
jest.mock('../../../modules/live-foreground', () => ({
  startLiveForeground: (o: unknown) => mockStartFg(o),
  stopLiveForeground: () => mockStopFg(),
  onLiveForegroundLeave: (listener: () => void) => {
    mockLeaveAction = listener;
    return () => mockOffLeave();
  },
}));

import { LiveTokenError } from '@/api/live';
import { notifyLiveSessionEnded, TOKEN_RETRY_DELAYS_MS, useLiveStore } from '@/stores/liveStore';

// Registered once when liveStore loads (read now: clearMocks wipes calls per test).
const beforeLecturePlay = (
  jest.requireMock('@/lib/audioController') as { onBeforeLecturePlay: jest.Mock }
).onBeforeLecturePlay.mock.calls[0]?.[0] as () => void;

const session: LiveSessionPublic = {
  id: 'sess-1',
  sectionId: 'sec-1',
  sectionTitle: 'العقيدة',
  sheikhId: 'sh-1',
  sheikhName: 'الشيخ محمد',
  title: 'شرح كتاب التوحيد',
  status: 'live',
  scheduledAt: null,
  startedAt: '2026-09-28T18:00:00Z',
  endedAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
};

const token = (over: Partial<LiveToken> = {}): LiveToken => ({
  token: 'jwt',
  url: 'wss://live.almahajja.app',
  roomName: 'stg_abc',
  identity: '0123456789abcdef',
  role: 'listener',
  name: 'عبد الله',
  hidden: false,
  gender: 'm',
  ...over,
});

let sink: LiveSink | null = null;
/** connectLive double: remembers the sink and reports a clean connect. */
function connectsOk() {
  mockConnect.mockImplementation(async (_params: unknown, s: LiveSink) => {
    sink = s;
    s.patch({ conn: 'connecting' });
    s.patch({ conn: 'ok', hostPresent: true });
  });
}
const patch = (p: LiveRoomPatch) => sink!.patch(p);
const state = () => useLiveStore.getState();
const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

beforeEach(() => {
  sink = null;
  mockLeaveAction = null;
  mockConnect.mockReset();
  mockFetchToken.mockReset();
  mockLiveControl.mockReset();
  mockLiveControl.mockResolvedValue({ ok: true });
  useLiveStore.setState({ preferredIdentity: null });
});

afterEach(async () => {
  // Reset the store AND its module-level join bookkeeping.
  await state().leave();
  jest.clearAllMocks();
});

describe('join', () => {
  test('closes the lecture first, starts the foreground service right after the token, then audio + connect', async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();

    await state().join(session);

    // stop(), not pause(): the lecture's lock-screen/headset controls must not
    // be able to restart it on top of the live (review finding #2).
    expect(mockStopLecture).toHaveBeenCalledTimes(1);
    expect(order(mockStopLecture)).toBeLessThan(order(mockFetchToken));
    // The service starts inside the tap's foreground window, before a slow
    // connect can outlast Android 12+'s background-start grace (finding #5).
    expect(order(mockFetchToken)).toBeLessThan(order(mockStartFg));
    expect(order(mockStartFg)).toBeLessThan(order(mockConfigure));
    expect(order(mockConfigure)).toBeLessThan(order(mockConnect));

    expect(mockFetchToken).toHaveBeenCalledWith('sess-1', undefined);
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'wss://live.almahajja.app', token: 'jwt' }),
      expect.anything(),
    );
    expect(mockStartFg).toHaveBeenCalledWith({
      title: 'مباشر الآن · شرح كتاب التوحيد',
      text: 'مع الشيخ محمد',
      url: 'riwaqalilm://live/sess-1',
    });
    expect(mockLeaveAction).not.toBeNull();

    expect(state()).toMatchObject({
      session,
      conn: 'ok',
      hostPresent: true,
      lastError: null,
      me: { identity: '0123456789abcdef', role: 'listener', hidden: false, gender: 'm' },
    });
  });

  test('no sheikh → the notification has no «مع …» line', async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join({ ...session, sheikhName: null });
    expect(mockStartFg).toHaveBeenCalledWith(expect.objectContaining({ text: '' }));
  });

  test('gender_required is surfaced (GenderPrompt) and leaves no half-joined session; a retry joins', async () => {
    mockFetchToken.mockRejectedValueOnce(new LiveTokenError('gender_required'));
    const err = await state().join(session).catch((e) => e);

    expect(err).toBeInstanceOf(LiveTokenError);
    expect(err.code).toBe('gender_required');
    expect(state()).toMatchObject({ session: null, conn: 'idle', lastError: 'gender_required' });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockStartFg).not.toHaveBeenCalled();
    expect(mockStopLecture).toHaveBeenCalled(); // the player was closed first

    // After GenderPrompt saved the gender:
    mockFetchToken.mockResolvedValueOnce(token({ gender: 'f', hidden: true, name: 'طالبة' }));
    connectsOk();
    await state().join(session);
    expect(state()).toMatchObject({ conn: 'ok', lastError: null, me: { gender: 'f', hidden: true } });
  });

  test.each(['not_open', 'banned', 'forbidden', 'not_found'] as const)(
    'token refusal %s → failed at once (no retry), code kept, error thrown',
    async (code) => {
      mockFetchToken.mockRejectedValueOnce(new LiveTokenError(code));
      await expect(state().join(session)).rejects.toMatchObject({ code });
      expect(state()).toMatchObject({ session, conn: 'failed', lastError: code });
      expect(mockFetchToken).toHaveBeenCalledTimes(1);
      expect(mockConnect).not.toHaveBeenCalled();
    },
  );

  describe('weak network: the first token request is retried quietly', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('a lost request, then success → joins (still «جارٍ الدخول» meanwhile)', async () => {
      mockFetchToken.mockRejectedValueOnce(new LiveTokenError('network')).mockResolvedValueOnce(token());
      connectsOk();
      const p = state().join(session);
      await jest.advanceTimersByTimeAsync(0);
      expect(state().conn).toBe('connecting');
      await jest.advanceTimersByTimeAsync(TOKEN_RETRY_DELAYS_MS[0]);
      await p;
      expect(mockFetchToken).toHaveBeenCalledTimes(2);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    test('three lost requests → failed/network', async () => {
      mockFetchToken.mockRejectedValue(new LiveTokenError('network'));
      const p = state().join(session).catch((e) => e);
      await jest.advanceTimersByTimeAsync(TOKEN_RETRY_DELAYS_MS[0] + TOKEN_RETRY_DELAYS_MS[1]);
      expect((await p).code).toBe('network');
      expect(mockFetchToken).toHaveBeenCalledTimes(3);
      expect(state()).toMatchObject({ session, conn: 'failed', lastError: 'network' });
    });

    test('leaving during the wait stops the retries', async () => {
      mockFetchToken.mockRejectedValue(new LiveTokenError('network'));
      const p = state().join(session).catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      await state().leave();
      await jest.advanceTimersByTimeAsync(10_000);
      await p;
      expect(mockFetchToken).toHaveBeenCalledTimes(1);
      expect(state().session).toBeNull();
    });
  });

  test('a non-LiveTokenError from the token call becomes unknown', async () => {
    mockFetchToken.mockRejectedValueOnce(new Error('boom'));
    await expect(state().join(session)).rejects.toMatchObject({ code: 'unknown' });
    expect(state().lastError).toBe('unknown');
  });

  test('a connect that fails 3 times → failed/network, audio released, no foreground service', async () => {
    mockFetchToken.mockResolvedValue(token());
    mockConnect.mockImplementation(async (_p: unknown, s: LiveSink) => {
      sink = s;
      s.patch({ conn: 'failed' });
      throw new Error('could not establish pc connection');
    });

    const err = await state().join(session).catch((e) => e);
    expect(err).toBeInstanceOf(LiveTokenError);
    expect(err.code).toBe('network');
    expect(err.message).toBe('تعذّر الدخول إلى الحلقة');
    expect(state()).toMatchObject({ session, conn: 'failed', lastError: 'network' });
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockStopAudio).toHaveBeenCalled();
    // Started after the token, stopped again with the failed connect.
    expect(mockStartFg).toHaveBeenCalledTimes(1);
    expect(mockStopFg).toHaveBeenCalled();
  });

  test('the room reads the store pause when it connects (a pause pressed while connecting sticks)', async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
    const params = mockConnect.mock.calls[0][0] as { isPaused: () => boolean };
    useLiveStore.setState({ paused: true });
    expect(params.isPaused()).toBe(true);
  });

  test('a lecture starting while in a live leaves the live (one audio owner)', async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
    expect(typeof beforeLecturePlay).toBe('function');

    beforeLecturePlay();
    await new Promise((r) => setTimeout(r, 0)); // leave() is fire-and-forget
    expect(state().session).toBeNull();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockLiveControl).toHaveBeenCalledWith('leave', { sessionId: 'sess-1' });
  });

  test('a lecture starting with no live does nothing', () => {
    beforeLecturePlay();
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockLiveControl).not.toHaveBeenCalled();
  });

  test('joining the room you are already in is a no-op', async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
    await state().join(session);
    expect(mockFetchToken).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test('joining another session leaves the first one', async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
    await state().join({ ...session, id: 'sess-2', title: 'مجلس آخر' });
    expect(mockLiveControl).toHaveBeenCalledWith('leave', { sessionId: 'sess-1' });
    expect(mockStopFg).toHaveBeenCalled();
    expect(state().session?.id).toBe('sess-2');
    expect(mockStartFg).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'riwaqalilm://live/sess-2' }));
  });

  test('a sister’s choice is sent and remembered; the next join reuses it', async () => {
    mockFetchToken.mockResolvedValue(token({ gender: 'f', hidden: true }));
    connectsOk();
    await state().join(session, { identityChoice: 'hidden' });
    expect(mockFetchToken).toHaveBeenLastCalledWith('sess-1', 'hidden');
    expect(state().preferredIdentity).toBe('hidden');

    await state().leave();
    await state().join(session);
    expect(mockFetchToken).toHaveBeenLastCalledWith('sess-1', 'hidden');
  });

  test('only preferredIdentity is persisted', () => {
    const opts = (useLiveStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => unknown } } })
      .persist.getOptions();
    expect(opts.partialize({ ...state(), preferredIdentity: 'named', session })).toEqual({ preferredIdentity: 'named' });
  });
});

describe('room patches', () => {
  beforeEach(async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
  });

  test('people/counts/speakers land in the store; my own role follows the room', async () => {
    const me = {
      identity: '0123456789abcdef',
      name: 'عبد الله',
      gender: 'm' as const,
      role: 'speaker' as const,
      hidden: false,
      hand: false,
      speaking: false,
      isMe: true,
    };
    patch({ people: { [me.identity]: me }, counts: { brothers: 1, sisters: 0 }, activeSpeakers: ['h1'] });
    expect(state()).toMatchObject({
      counts: { brothers: 1, sisters: 0 },
      activeSpeakers: ['h1'],
      me: { role: 'speaker' },
    });
  });

  test.each(['reconnecting', 'hostdrop', 'offline', 'poor'] as const)('%s is reflected as is', (conn) => {
    patch({ conn });
    expect(state().conn).toBe(conn);
  });

  test('ended keeps the session for «انتهى المجلس» but releases the foreground service and audio', async () => {
    patch({ conn: 'ended' });
    await Promise.resolve();
    expect(state()).toMatchObject({ session, conn: 'ended' });
    expect(order(mockOffLeave)).toBeLessThan(order(mockStopFg));
    expect(mockDisconnect).toHaveBeenCalled();
  });

  test('a later failure (re-join gave up) → failed/network', () => {
    patch({ conn: 'failed' });
    expect(state()).toMatchObject({ conn: 'failed', lastError: 'network' });
    expect(mockStopFg).toHaveBeenCalled();
  });

  test('patches from a room we already left are ignored', async () => {
    const stale = sink!;
    await state().leave();
    stale.patch({ conn: 'ok', counts: { brothers: 9, sisters: 9 } });
    expect(state()).toMatchObject({ session: null, conn: 'idle', counts: { brothers: 0, sisters: 0 } });
  });

  test('setPaused pauses listening locally (room stays connected)', () => {
    state().setPaused(true);
    expect(state().paused).toBe(true);
    expect(mockSetPaused).toHaveBeenCalledWith(true);
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  test('a session-ended poll routes through the room', () => {
    notifyLiveSessionEnded('sess-1');
    expect(mockMarkEnded).toHaveBeenCalled();
  });

  test('a session-ended poll with no room to route through ends the store directly', () => {
    mockMarkEnded.mockImplementationOnce(() => undefined); // no active run
    notifyLiveSessionEnded('sess-1');
    expect(state().conn).toBe('ended');
  });

  test('another session’s status is ignored', () => {
    notifyLiveSessionEnded('other');
    expect(mockMarkEnded).not.toHaveBeenCalled();
    expect(state().conn).toBe('ok');
  });
});

describe('leave', () => {
  beforeEach(async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
    jest.clearAllMocks();
  });

  test('disconnects, releases audio, unsubscribes «مغادرة» before stopping the service, clears the store', async () => {
    await state().leave();

    expect(mockOffLeave).toHaveBeenCalledTimes(1);
    expect(mockStopFg).toHaveBeenCalledTimes(1);
    expect(order(mockOffLeave)).toBeLessThan(order(mockStopFg));
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockStopAudio).toHaveBeenCalled();
    expect(mockLiveControl).toHaveBeenCalledWith('leave', { sessionId: 'sess-1' });
    expect(state()).toMatchObject({
      session: null,
      conn: 'idle',
      me: null,
      people: {},
      activeSpeakers: [],
      counts: { brothers: 0, sisters: 0 },
      hostPresent: false,
      paused: false,
      lastError: null,
    });
  });

  test('never resumes the lecture player', async () => {
    await state().leave();
    expect(mockToggleLecture).not.toHaveBeenCalled();
    expect(mockPlayLecture).not.toHaveBeenCalled();
  });

  test('keeps the remembered identity choice', async () => {
    useLiveStore.setState({ preferredIdentity: 'named' });
    await state().leave();
    expect(state().preferredIdentity).toBe('named');
  });

  test('the notification’s «مغادرة» action leaves the room', async () => {
    expect(mockLeaveAction).not.toBeNull();
    mockLeaveAction!();
    await Promise.resolve();
    await Promise.resolve();
    expect(state().session).toBeNull();
    expect(mockStopFg).toHaveBeenCalled();
  });

  test('leaving while the token is still loading drops the join', async () => {
    await state().leave();
    let resolveToken: (t: LiveToken) => void = () => undefined;
    mockFetchToken.mockReturnValueOnce(new Promise<LiveToken>((r) => (resolveToken = r)));
    const joining = state().join(session);
    await state().leave();
    resolveToken(token());
    await joining;
    expect(mockConnect).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ session: null, conn: 'idle' });
  });
});
