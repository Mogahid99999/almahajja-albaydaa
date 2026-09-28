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

test('a registered listener: «طلب الكلمة» stays disabled until P4', async () => {
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  Object.assign(mockState, { session: liveSession, conn: 'ok', me: { identity: 'b'.repeat(16), role: 'listener', hidden: false, gender: 'm' } });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('طلب الكلمة'));
  expect(screen.queryByText('سجّل أولاً لتطلب الكلمة')).toBeNull();
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
