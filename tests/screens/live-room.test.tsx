/**
 * app/live/[id].tsx — the «الحلقة» entry flow (V23 P3, PLAN_LIVE_V23 §7.3/§7.7).
 *
 * Guards the invariants the room screen owns (the store/client have their own
 * unit tests): a brother joins straight away; a sister who never chose is asked
 * «كيف تظهرين في الحلقة؟» BEFORE anything reaches live-token, and her choice
 * is what join() receives; `gender_required` from live-token opens
 * GenderPrompt, and choosing a gender re-joins WITHOUT closing the room (found
 * on R5CX10P3BPL: the prompt's onClose ran before onResolved and collapsed the
 * room — the join then happened behind Home); a guest's «طلب الكلمة» asks to
 * register first (owner rule: guests listen, never speak); an ended session
 * shows «انتهى المجلس» and never joins.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCollapse = jest.fn();
jest.mock('@/components/live/LivePeekSheet', () => ({
  LivePeekSheet: ({ children }: { children: (c: () => void) => unknown }) => children(mockCollapse),
}));
// The SVG board has its own geometry tests (halaqaLayout); render-only here.
jest.mock('@/components/live/Halaqa', () => ({ Halaqa: () => null }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 's1' }),
  useRouter: () => mockRouter,
}));

const mockUser: { current: Record<string, unknown> } = { current: {} };
// Saving the gender succeeds at once (GenderPrompt → onClose, then onResolved).
const mockUpdateProfile = {
  mutate: jest.fn((_v: unknown, o?: { onSuccess?: () => void }) => o?.onSuccess?.()),
  isPending: false,
};
jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockUser.current }),
  useUpdateProfile: () => mockUpdateProfile,
}));

const mockSession: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession.current, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: [] }),
}));

const mockJoin = jest.fn();
const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { LiveTokenError } from '@/api/live';
import LiveRoomScreen from '../../app/live/[id]';

const liveSession = {
  id: 's1',
  sectionId: 'sec1',
  sectionTitle: 'العقيدة',
  sheikhId: 'sh1',
  sheikhName: 'الشيخ عبد الله',
  title: 'شرح كتاب التوحيد',
  status: 'live',
  scheduledAt: null,
  startedAt: '2026-09-28T18:00:00Z',
  endedAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
};

function resetStore() {
  Object.assign(mockState, {
    session: null,
    conn: 'idle',
    me: null,
    people: {},
    counts: { brothers: 0, sisters: 0 },
    activeSpeakers: [],
    hostPresent: false,
    paused: false,
    preferredIdentity: null,
    lastError: null,
    join: mockJoin,
    leave: jest.fn(() => Promise.resolve()),
    setPaused: jest.fn(),
    setPreferredIdentity: jest.fn(),
    // P4
    notice: null,
    micOn: false,
    handBusy: false,
    micBusy: false,
    allowRequests: true,
    raiseHand: jest.fn(() => Promise.resolve()),
    lowerHand: jest.fn(() => Promise.resolve()),
    setMic: jest.fn(() => Promise.resolve()),
    stepDown: jest.fn(() => Promise.resolve()),
    moderate: jest.fn(() => Promise.resolve()),
    setAllowRequests: jest.fn(() => Promise.resolve()),
    handOver: jest.fn(() => Promise.resolve()),
    endForAll: jest.fn(() => Promise.resolve()),
    clearNotice: jest.fn(),
  });
}

beforeEach(() => {
  resetStore();
  mockJoin.mockReset();
  // Like the real join(): the session lands in the store synchronously.
  mockJoin.mockImplementation(async (sess: unknown) => {
    Object.assign(mockState, { session: sess, conn: 'connecting' });
  });
  mockSession.current = liveSession;
});

test('a brother joins straight away — no identity question', async () => {
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  await render(<LiveRoomScreen />);
  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(mockJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), undefined);
  expect(screen.queryByText('كيف تظهرين في الحلقة؟')).toBeNull();
  expect(screen.getByText('شرح كتاب التوحيد')).toBeTruthy();
  expect(screen.getByLabelText('مغادرة الحلقة')).toBeTruthy();
  expect(mockCollapse).not.toHaveBeenCalled(); // opening never auto-closes
});

test('left from the notification while the room is open → the screen closes', async () => {
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  Object.assign(mockState, { session: liveSession, conn: 'ok' });
  const { rerender } = await render(<LiveRoomScreen />);
  expect(mockCollapse).not.toHaveBeenCalled();

  Object.assign(mockState, { session: null, conn: 'idle' }); // «مغادرة» → leave()
  await rerender(<LiveRoomScreen />);
  expect(mockCollapse).toHaveBeenCalledTimes(1);
  expect(mockJoin).not.toHaveBeenCalled(); // never silently re-joins
});

test('«مغادرة الحلقة» in the dock leaves once and closes once — no re-join', async () => {
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  const mockLeave = jest.fn(async () => {
    Object.assign(mockState, { session: null, conn: 'idle' });
  });
  Object.assign(mockState, { session: liveSession, conn: 'ok', leave: mockLeave });
  const { rerender } = await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  await rerender(<LiveRoomScreen />);
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockCollapse).toHaveBeenCalledTimes(1);
  expect(mockJoin).not.toHaveBeenCalled();
});

test('a sister chooses «بدون اسم» before join() — the choice is what join receives', async () => {
  mockUser.current = { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' };
  await render(<LiveRoomScreen />);
  expect(screen.getByText('كيف تظهرين في الحلقة؟')).toBeTruthy();
  expect(mockJoin).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('بدون اسم'));
  await fireEvent.press(screen.getByText('دخول الحلقة'));
  expect(mockJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), { identityChoice: 'hidden' });
});

test('a sister who already chose on this device is not asked again', async () => {
  mockUser.current = { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' };
  mockState.preferredIdentity = 'named';
  await render(<LiveRoomScreen />);
  expect(screen.queryByText('كيف تظهرين في الحلقة؟')).toBeNull();
  expect(mockJoin).toHaveBeenCalledTimes(1);
});

test('gender_required from live-token opens the gender prompt', async () => {
  mockUser.current = { id: 'g1', role: 'student', isGuest: true, displayName: null, gender: null };
  mockJoin.mockImplementation(async () => {
    throw new LiveTokenError('gender_required');
  });
  await render(<LiveRoomScreen />);
  await act(async () => {});
  expect(
    screen.getByText('لتجلس في مكانك من الحلقة بين الإخوة أو الأخوات، حدّد جنسك مرة واحدة.'),
  ).toBeTruthy();
});

test('choosing a gender after gender_required re-joins and keeps the room open', async () => {
  mockUser.current = { id: 'g1', role: 'student', isGuest: true, displayName: null, gender: null };
  mockJoin.mockImplementationOnce(async () => {
    throw new LiveTokenError('gender_required');
  });
  await render(<LiveRoomScreen />);
  await act(async () => {});
  await fireEvent.press(screen.getByText('ذكر'));
  await fireEvent.press(screen.getByText('متابعة'));
  expect(mockJoin).toHaveBeenCalledTimes(2);
  expect(mockCollapse).not.toHaveBeenCalled();
});

test('a guest listens, but «طلب الكلمة» asks to register first', async () => {
  mockUser.current = { id: 'g1', role: 'student', isGuest: true, displayName: null, gender: 'male' };
  Object.assign(mockState, { session: liveSession, conn: 'ok', me: { identity: 'a'.repeat(16), role: 'listener', hidden: false, gender: 'm' } });
  await render(<LiveRoomScreen />);
  expect(mockJoin).not.toHaveBeenCalled(); // already in this room

  await fireEvent.press(screen.getByLabelText('طلب الكلمة'));
  expect(screen.getByText('سجّل أولاً لتطلب الكلمة')).toBeTruthy();
  await fireEvent.press(screen.getByText('تسجيل'));
  expect(mockRouter.push).toHaveBeenCalledWith('/register');
});

// ─── P4: the dock's speaking controls ───────────────────────────────────────

const ME = 'b'.repeat(16);
function listenerIn(extra: Record<string, unknown> = {}, handUp = false) {
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  Object.assign(mockState, {
    session: liveSession,
    conn: 'ok',
    me: { identity: ME, role: 'listener', hidden: false, gender: 'm' },
    people: {
      [ME]: {
        identity: ME, name: 'أحمد', gender: 'm', role: 'listener', hidden: false,
        hand: handUp, handAt: handUp ? 1_790_000_000 : null, micOn: false, speaking: false, isMe: true,
      },
    },
    ...extra,
  });
}

test('a registered listener raises a hand — then «طلب الكلمة» rests 5 s (client rate limit)', async () => {
  jest.useFakeTimers();
  try {
    listenerIn();
    await render(<LiveRoomScreen />);
    await fireEvent.press(screen.getByText('طلب الكلمة'));
    expect(mockState.raiseHand).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('سجّل أولاً لتطلب الكلمة')).toBeNull();

    await fireEvent.press(screen.getByText('طلب الكلمة')); // still resting
    expect(mockState.raiseHand).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await fireEvent.press(screen.getByText('طلب الكلمة'));
    expect(mockState.raiseHand).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('with my hand up the dock says «بانتظار الإذن · إلغاء» and lowers it', async () => {
  listenerIn({}, true);
  await render(<LiveRoomScreen />);
  expect(screen.queryByText('طلب الكلمة')).toBeNull();
  await fireEvent.press(screen.getByText('بانتظار الإذن · إلغاء'));
  expect(mockState.lowerHand).toHaveBeenCalledTimes(1);
  expect(mockState.raiseHand).not.toHaveBeenCalled();
});

test('while a hand request is in flight «طلب الكلمة» does nothing', async () => {
  listenerIn({ handBusy: true });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByText('طلب الكلمة'));
  expect(mockState.raiseHand).not.toHaveBeenCalled();
});

test('requests closed by the moderators: disabled with the §15 hint', async () => {
  listenerIn({ allowRequests: false });
  await render(<LiveRoomScreen />);
  expect(screen.getByText('لا يستقبل المشرفون طلبات الكلمة الآن')).toBeTruthy();
  await fireEvent.press(screen.getByText('طلب الكلمة'));
  expect(mockState.raiseHand).not.toHaveBeenCalled();
});

test('a guest never reaches raiseHand — «طلب الكلمة» is still the register sheet', async () => {
  mockUser.current = { id: 'g1', role: 'student', isGuest: true, displayName: null, gender: 'male' };
  Object.assign(mockState, { session: liveSession, conn: 'ok', me: { identity: 'a'.repeat(16), role: 'listener', hidden: false, gender: 'm' } });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('طلب الكلمة'));
  expect(screen.getByText('سجّل أولاً لتطلب الكلمة')).toBeTruthy();
  expect(mockState.raiseHand).not.toHaveBeenCalled();
});

test('a speaker gets the mic toggle and a visible «العودة إلى الاستماع»', async () => {
  listenerIn({ me: { identity: ME, role: 'speaker', hidden: false, gender: 'm' } });
  await render(<LiveRoomScreen />);
  expect(screen.queryByText('طلب الكلمة')).toBeNull();
  expect(screen.getByText('الميكروفون مغلق')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('فتح الميكروفون'));
  expect(mockState.setMic).toHaveBeenCalledWith(true);

  await fireEvent.press(screen.getByText('العودة إلى الاستماع'));
  expect(screen.getByText('العودة إلى الاستماع؟')).toBeTruthy();
  const confirm = screen.getAllByText('العودة إلى الاستماع');
  await fireEvent.press(confirm[confirm.length - 1]);
  expect(mockState.stepDown).toHaveBeenCalledTimes(1);
});

test('an open mic reads «الميكروفون مفتوح» and closes; staff have no «العودة إلى الاستماع»', async () => {
  listenerIn({ me: { identity: ME, role: 'moderator', hidden: false, gender: 'm' }, micOn: true });
  mockUser.current = { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' };
  await render(<LiveRoomScreen />);
  expect(screen.getByText('الميكروفون مفتوح')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('إغلاق الميكروفون'));
  expect(mockState.setMic).toHaveBeenCalledWith(false);
  expect(screen.queryByText('العودة إلى الاستماع')).toBeNull();
});

test('a room notice shows its §15 copy, then clears itself after ~6 s', async () => {
  jest.useFakeTimers();
  try {
    listenerIn({ notice: { kind: 'accepted', id: 1 } });
    await render(<LiveRoomScreen />);
    expect(
      screen.getByText('صرت من المتحدثين. افتح الميكروفون وأغلقه متى شئت. المجلس يُسجَّل وصوتك ضمنه'),
    ).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(5900);
    });
    expect(mockState.clearNotice).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockState.clearNotice).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('an ended session shows «انتهى المجلس» and never joins', async () => {
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  mockSession.current = { ...liveSession, status: 'ended' };
  await render(<LiveRoomScreen />);
  expect(screen.getByText('انتهى المجلس')).toBeTruthy();
  expect(screen.getByText('جزاكم الله خيراً على الحضور')).toBeTruthy();
  expect(mockJoin).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('العودة'));
  expect(mockCollapse).toHaveBeenCalled();
});
