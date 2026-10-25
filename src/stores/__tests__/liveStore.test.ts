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
 *  - a sister's identity choice is remembered (preferredIdentity);
 *  - the room follows the signed-in user (followAuthUser): a sign-in while in
 *    a live re-joins the same session as the new user, once.
 */
import type { LiveSessionPublic, LiveToken } from '@/api/live';
import type { LiveRoomPatch, LiveSink } from '@/lib/liveClient';

const mockConfigure = jest.fn(async () => undefined);
const mockConnect = jest.fn();
const mockDisconnect = jest.fn(async () => undefined);
const mockStopAudio = jest.fn(async () => undefined);
const mockSetPaused = jest.fn();
const mockMarkEnded = jest.fn();
const mockConfigureSpeaking = jest.fn(async () => undefined);
const mockSetMic = jest.fn(async (_on: boolean) => undefined);
const mockReleaseMic = jest.fn(async () => undefined);
const mockMicPermission = jest.fn(async () => undefined);
const mockSendReaction = jest.fn(async (_k: string) => true);
jest.mock('@/lib/liveClient', () => ({
  MicPermissionError: class MicPermissionError extends Error {},
  configureSpeakingAudio: () => mockConfigureSpeaking(),
  setMicEnabled: (on: boolean) => mockSetMic(on),
  releaseMic: () => mockReleaseMic(),
  requestMicPermission: () => mockMicPermission(),
  getMicLevel: () => 0.5,
  configureListeningAudio: () => mockConfigure(),
  connectLive: (...a: unknown[]) => mockConnect(...a),
  disconnectLive: () => mockDisconnect(),
  stopLiveAudio: () => mockStopAudio(),
  setLivePaused: (p: boolean) => mockSetPaused(p),
  markSessionEnded: () => mockMarkEnded(),
  sendLiveReaction: (k: string) => mockSendReaction(k),
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
import { queryKeys } from '@/constants/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  endedHere,
  followAuthUser,
  notifyLiveSessionEnded,
  onLiveComments,
  TOKEN_RETRY_DELAYS_MS,
  useLiveStore,
} from '@/stores/liveStore';

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
      withMic: false,
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

  test('entering greets with the du\'a once connected; a sister\'s identity re-join does not repeat it', async () => {
    mockFetchToken.mockResolvedValue(token({ gender: 'f', hidden: false }));
    connectsOk();
    await state().join(session);
    expect(state().notice?.kind).toBe('joined');

    useLiveStore.setState({ notice: null });
    state().setPreferredIdentity('hidden');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(state().notice).toBeNull();
  });

  test('the host\'s green room gets no du\'a notice', async () => {
    mockFetchToken.mockResolvedValue(token({ role: 'host' }));
    connectsOk();
    await state().openGreen({ ...session, status: 'green' });
    expect(state().notice?.kind).not.toBe('joined');
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
      handAt: null,
      micOn: false,
      speaking: false,
      isMe: true,
      reactBlocked: false,
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

describe('P4 speaking & moderation', () => {
  const ME = '0123456789abcdef';
  const person = (role: 'listener' | 'speaker' | 'host' | 'moderator', over: Record<string, unknown> = {}) => ({
    [ME]: {
      identity: ME,
      name: 'عبد الله',
      gender: 'm' as const,
      role,
      hidden: false,
      hand: false,
      handAt: null,
      micOn: false,
      speaking: false,
      isMe: true,
      reactBlocked: false,
      ...over,
    },
  });

  beforeEach(async () => {
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
  });

  test('raising a hand goes through live-control `hand` (the server sets h) → «رفعت يدك»', async () => {
    await state().raiseHand();
    expect(mockLiveControl).toHaveBeenCalledWith('hand', { sessionId: 'sess-1', up: true });
    expect(state().notice?.kind).toBe('hand_raised');
    expect(state().handBusy).toBe(false);
  });

  test('the mic permission is asked BEFORE the hand goes up; refused → no request (the post-dialog reconnect regression)', async () => {
    mockMicPermission.mockRejectedValueOnce(new Error('denied'));
    await state().raiseHand();
    expect(mockLiveControl).not.toHaveBeenCalledWith('hand', expect.anything());
    expect(state().notice?.kind).toBe('mic_denied');
    await state().raiseHand();
    expect(order(mockMicPermission)).toBeLessThan(mockLiveControl.mock.invocationCallOrder.at(-1)!);
  });

  test('a closed request queue / rate limit becomes its own notice, never a throw', async () => {
    const { LiveControlError } = jest.requireActual('@/api/live');
    mockLiveControl.mockRejectedValueOnce(new LiveControlError('requests_closed'));
    await state().raiseHand();
    expect(state().notice?.kind).toBe('requests_closed');
    mockLiveControl.mockRejectedValueOnce(new LiveControlError('rate_limited'));
    await state().lowerHand();
    expect(state().notice?.kind).toBe('rate_limited');
  });

  test('approved (listener → speaker from the room) → «صرت من المتحدثين…»', () => {
    patch({ people: person('speaker') });
    expect(state().me?.role).toBe('speaker');
    expect(state().notice?.kind).toBe('accepted');
  });

  test('demoted by a moderator → «أعادك المشرف إلى الاستماع…»', () => {
    patch({ people: person('speaker') });
    patch({ people: person('listener') });
    expect(state().notice?.kind).toBe('demoted');
  });

  test('stepping down myself drops the mic and shows no «أعادك المشرف» notice (D1)', async () => {
    patch({ people: person('speaker') });
    state().clearNotice();
    await state().stepDown();
    expect(mockReleaseMic).toHaveBeenCalled();
    expect(mockLiveControl).toHaveBeenCalledWith('demote', { sessionId: 'sess-1', identity: ME });
    patch({ people: person('listener') });
    expect(state().notice).toBeNull();
  });

  test('a rejection / moderator mute from the room become notices', () => {
    sink!.event?.({ type: 'rejected' });
    expect(state().notice?.kind).toBe('rejected');
    sink!.event?.({ type: 'mutedByModerator' });
    expect(state().notice?.kind).toBe('muted');
  });

  test('«التعليقات» data messages reach the subscribers with the session id — not a notice', () => {
    const got: unknown[] = [];
    const off = onLiveComments((sessionId, msg) => got.push([sessionId, msg]));
    const notice = state().notice;
    sink!.event?.({ type: 'comments', msg: { t: 'del', id: 'c1' } });
    expect(got).toEqual([['sess-1', { t: 'del', id: 'c1' }]]);
    expect(state().notice).toBe(notice);
    off();
    sink!.event?.({ type: 'comments', msg: { t: 'del', id: 'c2' } });
    expect(got).toHaveLength(1);
  });

  test('opening the mic re-types the foreground service to microphone', async () => {
    patch({ people: person('speaker') });
    await state().setMic(true);
    expect(mockSetMic).toHaveBeenCalledWith(true);
    expect(mockStartFg).toHaveBeenLastCalledWith(expect.objectContaining({ withMic: true }));
  });

  test('a refused OS mic permission → «اسمح للتطبيق باستخدام الميكروفون»', async () => {
    const { MicPermissionError } = jest.requireMock('@/lib/liveClient');
    mockSetMic.mockRejectedValueOnce(new MicPermissionError());
    await state().setMic(true);
    expect(state().notice?.kind).toBe('mic_denied');
    expect(state().micBusy).toBe(false);
  });

  test('moderation passes the target identity to live-control', async () => {
    await state().moderate('approve', 'fedcba9876543210');
    expect(mockLiveControl).toHaveBeenCalledWith('approve', { sessionId: 'sess-1', identity: 'fedcba9876543210' });
  });

  test('ending for everyone ends the room at once (ROOM_DELETED may lag)', async () => {
    await state().endForAll();
    expect(mockLiveControl).toHaveBeenCalledWith('end', { sessionId: 'sess-1' });
    expect(mockMarkEnded).toHaveBeenCalled();
  });

  test('handing over calls host_leave then leaves the room', async () => {
    await state().handOver('fedcba9876543210');
    expect(mockLiveControl).toHaveBeenCalledWith('host_leave', { sessionId: 'sess-1', identity: 'fedcba9876543210' });
    expect(state().session).toBeNull();
  });
});

describe('ending while this device is still joining (owner 2026-10-05 «احاول انهاء البث, معلق»)', () => {
  test('«إنهاء البث للجميع» cancels the join at once and the open screen reads the session as ended', async () => {
    mockFetchToken.mockResolvedValue(token({ role: 'host' }));
    // The LiveKit connect never finishes (the room is being deleted under it).
    mockConnect.mockImplementation((_p: unknown, s: LiveSink) => {
      sink = s;
      return new Promise(() => undefined);
    });
    queryClient.setQueryData(queryKeys.liveSession('sess-1'), session);
    void state().join(session);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(state().conn).toBe('connecting');

    await state().endForAll();

    expect(mockLiveControl).toHaveBeenCalledWith('end', { sessionId: 'sess-1' });
    expect(state().conn).toBe('ended');
    expect(mockDisconnect).toHaveBeenCalled();
    expect(queryClient.getQueryData<LiveSessionPublic>(queryKeys.liveSession('sess-1'))?.status).toBe('ended');
    // A late patch from the abandoned connect cannot revive the room.
    sink!.patch({ conn: 'ok' });
    expect(state().conn).toBe('ended');
  });

  test('ended from the staff card (endedHere): the same, with no room action needed', async () => {
    mockFetchToken.mockResolvedValue(token());
    mockConnect.mockImplementation(() => new Promise(() => undefined));
    void state().join(session);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    endedHere('sess-1');
    expect(state().conn).toBe('ended');
    // Another session id is not this room's business.
    endedHere('other');
    expect(state().conn).toBe('ended');
  });
});

describe('P4 green room', () => {
  const scheduled = { ...session, status: 'scheduled' as const, startedAt: null };

  test('opens green, joins with the SPEAKING profile + a mic service, then opens the mic', async () => {
    mockLiveControl.mockResolvedValueOnce({ ok: true, status: 'green' });
    mockFetchToken.mockResolvedValue(token({ role: 'host' }));
    connectsOk();
    await state().openGreen(scheduled);
    expect(mockLiveControl).toHaveBeenCalledWith('open_green', { sessionId: 'sess-1' });
    expect(order(mockMicPermission)).toBeLessThan(order(mockStartFg));
    expect(mockStartFg).toHaveBeenCalledWith(expect.objectContaining({ withMic: true }));
    expect(mockConfigureSpeaking).toHaveBeenCalled();
    expect(mockConfigure).not.toHaveBeenCalled();
    expect(mockSetMic).toHaveBeenCalledWith(true);
    expect(state().session?.status).toBe('green');
  });

  test('start flips the session to live', async () => {
    mockFetchToken.mockResolvedValue(token({ role: 'host' }));
    connectsOk();
    await state().openGreen({ ...session, status: 'green' });
    mockLiveControl.mockResolvedValueOnce({ ok: true, status: 'live' });
    await state().startBroadcast();
    expect(mockLiveControl).toHaveBeenCalledWith('start', { sessionId: 'sess-1' });
    expect(state().session?.status).toBe('live');
  });

  test('the sheikh re-entering his own LIVE session gets his mic back without a tap', async () => {
    mockFetchToken.mockResolvedValue(token({ role: 'host' }));
    connectsOk();
    await state().join(session);
    await Promise.resolve();
    expect(mockSetMic).toHaveBeenCalledWith(true);
  });
});

// Device report 2026-09-30: a guest in the majlis (minimised to the mini-bar)
// signed in as the sheikh; the room stayed on the guest identity — «طلب
// التحدث» and «أنت» as a listener. useAuth reports each signed-in user id here.
describe('sign-in while in a live re-joins as the new user', () => {
  const GUEST = '0000000000guest1';
  const SHEIKH = '000000000sheikh1';
  const tokenCall = (n: number) => mockFetchToken.mock.invocationCallOrder[n];

  async function joinedAsGuest() {
    await followAuthUser('user-guest');
    mockFetchToken.mockResolvedValueOnce(token({ identity: GUEST }));
    connectsOk();
    await state().join(session);
    expect(state().me?.identity).toBe(GUEST);
  }

  test('user A joined → auth user becomes B → the old room is dropped and the SAME session re-joined as B', async () => {
    await joinedAsGuest();
    mockFetchToken.mockResolvedValueOnce(token({ identity: SHEIKH, role: 'host', name: 'الشيخ محمد' }));

    await followAuthUser('user-sheikh');

    // The guest's connection is gone before B's token is asked for…
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockStopFg).toHaveBeenCalled();
    expect(order(mockDisconnect)).toBeLessThan(tokenCall(1));
    // …then the same session, with B's token and a new room connection.
    expect(mockFetchToken).toHaveBeenCalledTimes(2);
    expect(mockFetchToken).toHaveBeenLastCalledWith('sess-1', undefined);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ session, conn: 'ok', me: { identity: SHEIKH, role: 'host' } });
    // The host of this live gets his mic back, as on any re-entry.
    expect(mockSetMic).toHaveBeenCalledWith(true);
    // No live-control `leave`: the JWT is already B's — it could only close B's own row.
    expect(mockLiveControl).not.toHaveBeenCalledWith('leave', expect.anything());
  });

  test('the same user id again (register upgrades the guest in place) → nothing', async () => {
    await joinedAsGuest();
    await followAuthUser('user-guest');
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockFetchToken).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ conn: 'ok', me: { identity: GUEST } });
  });

  test('sign-out → leave only: the restored guest reported afterwards is not re-joined', async () => {
    await joinedAsGuest();
    await state().leave(); // useSignOut leaves BEFORE the session switches
    await followAuthUser('user-other-guest');
    expect(mockLiveControl.mock.calls.filter(([action]) => action === 'leave')).toHaveLength(1);
    expect(mockFetchToken).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ session: null, conn: 'idle' });
  });

  test('with no live, a sign-in touches nothing', async () => {
    await followAuthUser('user-guest');
    await followAuthUser('user-sheikh');
    expect(mockFetchToken).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  test('repeated reports of the new user re-join once (no loop)', async () => {
    await joinedAsGuest();
    mockFetchToken.mockResolvedValue(token({ identity: SHEIKH }));
    await Promise.all([followAuthUser('user-b'), followAuthUser('user-b')]);
    await followAuthUser('user-b');
    expect(mockFetchToken).toHaveBeenCalledTimes(2);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  test('a refused re-join (gender_required) ends like any join refusal, never thrown', async () => {
    await joinedAsGuest();
    mockFetchToken.mockRejectedValueOnce(new LiveTokenError('gender_required'));
    await expect(followAuthUser('user-b')).resolves.toBeUndefined();
    expect(state()).toMatchObject({ session: null, conn: 'idle', lastError: 'gender_required' });
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test('a banned new account → the room shows the refusal (failed + code)', async () => {
    await joinedAsGuest();
    mockFetchToken.mockRejectedValueOnce(new LiveTokenError('banned'));
    await followAuthUser('user-b');
    expect(state()).toMatchObject({ session, conn: 'failed', lastError: 'banned' });
  });
});

describe('0157 reactions «التفاعل»', () => {
  const ME = '0123456789abcdef';
  const meAs = (over: Record<string, unknown> = {}) => ({
    [ME]: {
      identity: ME, name: 'عبد الله', gender: 'm' as const, role: 'listener' as const, hidden: false,
      hand: false, handAt: null, micOn: false, speaking: false, isMe: true, reactBlocked: false, ...over,
    },
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    mockSendReaction.mockClear();
    mockFetchToken.mockResolvedValue(token());
    connectsOk();
    await state().join(session);
    patch({ people: meAs() });
  });
  afterEach(() => jest.useRealTimers());

  test('sent over LiveKit (never the DB), shown to me at once, then a 1.2 s cooldown', async () => {
    const { onLiveReaction } = jest.requireActual('../liveStore') as typeof import('../liveStore');
    const seen: unknown[] = [];
    const off = onLiveReaction((e) => seen.push(e));
    expect(await state().sendReaction('like')).toBe('sent');
    expect(mockSendReaction).toHaveBeenCalledWith('like');
    expect(mockLiveControl).not.toHaveBeenCalled();
    expect(seen).toEqual([{ key: 'like', identity: ME, mine: true }]);
    expect(await state().sendReaction('love')).toBe('cooldown');
    jest.setSystemTime(Date.now() + 1_200);
    expect(await state().sendReaction('love')).toBe('sent');
    off();
  });

  test('stopped by a moderator: nothing is sent', async () => {
    patch({ people: meAs({ reactBlocked: true }) });
    expect(await state().sendReaction('like')).toBe('blocked');
    expect(mockSendReaction).not.toHaveBeenCalled();
  });

  test('received reactions are thinned per sender (a modified client cannot flood my screen)', () => {
    const { onLiveReaction } = jest.requireActual('../liveStore') as typeof import('../liveStore');
    const seen: string[] = [];
    const off = onLiveReaction((e) => seen.push(`${e.identity}:${e.key}`));
    sink!.event?.({ type: 'reaction', key: 'like', identity: 'x1' });
    sink!.event?.({ type: 'reaction', key: 'love', identity: 'x1' }); // same sender, too soon
    sink!.event?.({ type: 'reaction', key: 'dua', identity: 'x2' });
    expect(seen).toEqual(['x1:like', 'x2:dua']);
    off();
  });

  test('react_block / react_unblock go to live-control with the target and the flag', async () => {
    await state().moderate('react_block', 'fedcba9876543210');
    expect(mockLiveControl).toHaveBeenCalledWith('react_block', {
      sessionId: 'sess-1',
      identity: 'fedcba9876543210',
      blocked: true,
    });
    await state().moderate('react_unblock', 'fedcba9876543210');
    expect(mockLiveControl).toHaveBeenLastCalledWith('react_block', {
      sessionId: 'sess-1',
      identity: 'fedcba9876543210',
      blocked: false,
    });
  });
});
