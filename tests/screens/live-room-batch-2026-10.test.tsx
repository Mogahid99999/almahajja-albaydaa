/**
 * The live room — owner batch 2026-10-05:
 *  - ONE number on the room's face, «الحضور»; no brothers / sisters line;
 *  - names across the hijab: an ordinary attendee sees his own side's names
 *    only in «في الحلقة»; a hidden sister stays «طالبة»; staff see all;
 *  - «التفاعل»: the smile pill opens the six signs, a tap sends one; a guest is
 *    asked to register; a person a moderator stopped is told so.
 * Assertions are on the Arabic the user reads.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/live/LivePeekSheet', () => ({
  LivePeekSheet: ({ children }: { children: (c: () => void) => unknown }) => children(jest.fn()),
}));
jest.mock('@/components/live/Halaqa', () => ({ Halaqa: () => null }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 's1' }),
  useRouter: () => mockRouter,
}));

const mockUser: { current: Record<string, unknown> } = { current: {} };
jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockUser.current }),
  useUpdateProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: [] }),
}));
jest.mock('@/hooks/useLiveComments', () => ({
  useLiveComments: () => ({ comments: [], isLoading: false, isError: false, refetch: jest.fn(), unseen: 0 }),
  usePostLiveComment: () => ({ mutate: jest.fn(), isPending: false }),
  useLiveCommentAction: () => ({ mutate: jest.fn(), isPending: false, variables: undefined }),
}));
const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore, onLiveReaction: () => () => undefined };
});

import LiveRoomScreen from '../../app/live/[id]';

const mockSession = {
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

const ME = 'a'.repeat(16);
const p = (identity: string, over: Record<string, unknown>) => ({
  identity,
  name: identity,
  gender: 'm',
  role: 'listener',
  hidden: false,
  hand: false,
  handAt: null,
  micOn: false,
  speaking: false,
  isMe: false,
  reactBlocked: false,
  ...over,
});

function enter(opts: { me: Record<string, unknown>; meGender: 'm' | 'f'; user: Record<string, unknown> }) {
  mockUser.current = opts.user;
  const people = {
    host: p('host', { name: 'الشيخ عبد الله', role: 'host', micOn: true }),
    b1: p('b1', { name: 'خالد' }),
    b2: p('b2', { name: 'سعيد' }),
    s1: p('s1', { name: 'فاطمة', gender: 'f' }),
    s2: p('s2', { name: 'طالبة', gender: 'f', hidden: true }),
    [ME]: p(ME, { name: 'أنا', gender: opts.meGender, isMe: true, ...opts.me }),
  };
  Object.assign(mockState, {
    session: mockSession,
    conn: 'ok',
    me: { identity: ME, role: 'listener', hidden: false, gender: opts.meGender },
    people,
    counts: { brothers: opts.meGender === 'm' ? 3 : 2, sisters: opts.meGender === 'f' ? 3 : 2 },
    activeSpeakers: [],
    hostPresent: true,
    paused: false,
    preferredIdentity: 'named',
    lastError: null,
    join: jest.fn(),
    leave: jest.fn(() => Promise.resolve()),
    setPaused: jest.fn(),
    setPreferredIdentity: jest.fn(),
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
    sendReaction: jest.fn(() => Promise.resolve('sent')),
    setAllowRequests: jest.fn(() => Promise.resolve()),
    handOver: jest.fn(() => Promise.resolve()),
    endForAll: jest.fn(() => Promise.resolve()),
    clearNotice: jest.fn(),
  });
}

const brother = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
const sister = { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' };

beforeEach(() => {
  for (const k of Object.keys(mockState)) delete mockState[k];
  mockRouter.push.mockReset();
});

test('the room shows ONE number, «الحضور» — no brothers / sisters line', async () => {
  enter({ me: {}, meGender: 'm', user: brother });
  await render(<LiveRoomScreen />);
  expect(screen.getByLabelText('الحضور ٦')).toBeTruthy();
  expect(screen.queryByText(/من الإخوة/)).toBeNull();
  expect(screen.queryByText(/من الأخوات/)).toBeNull();
});

test('a brother sees the brothers by name, the sisters as a number only', async () => {
  enter({ me: {}, meGender: 'm', user: brother });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getAllByLabelText('من في الحلقة')[0]);
  expect(screen.getByText('خالد')).toBeTruthy();
  expect(screen.getByText('سعيد')).toBeTruthy();
  expect(screen.getAllByText('الشيخ عبد الله').length).toBeGreaterThan(0); // the sheikh, for everyone
  expect(screen.queryByText('فاطمة')).toBeNull();
  expect(screen.queryByText('طالبة')).toBeNull();
  expect(screen.getByText('الأخوات · ٢')).toBeTruthy();
  expect(screen.getByText('أسماء الأخوات تظهر للأخوات فقط')).toBeTruthy();
});

test('a sister sees the sisters — a hidden one as «طالبة» — and the brothers as a number only', async () => {
  enter({ me: {}, meGender: 'f', user: sister });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getAllByLabelText('من في الحلقة')[0]);
  expect(screen.getByText('فاطمة')).toBeTruthy();
  expect(screen.getByText('طالبة')).toBeTruthy();
  expect(screen.queryByText('خالد')).toBeNull();
  expect(screen.queryByText('سعيد')).toBeNull();
  expect(screen.getByText('الإخوة · ٢')).toBeTruthy();
  expect(screen.getByText('أسماء الإخوة تظهر للإخوة فقط')).toBeTruthy();
});

test('staff see every name on both sides', async () => {
  enter({ me: {}, meGender: 'm', user: { ...brother, role: 'admin' } });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getAllByLabelText('من في الحلقة')[0]);
  expect(screen.getByText('خالد')).toBeTruthy();
  expect(screen.getByText('فاطمة')).toBeTruthy();
});

test('«التفاعل»: the smile pill opens the six signs; a tap sends that one', async () => {
  enter({ me: {}, meGender: 'm', user: brother });
  await render(<LiveRoomScreen />);
  expect(screen.queryByLabelText('أعجبني')).toBeNull();
  await fireEvent.press(screen.getByLabelText('تفاعل'));
  await fireEvent.press(screen.getByLabelText('أعجبني'));
  expect(mockState.sendReaction).toHaveBeenCalledWith('like');
  await fireEvent.press(screen.getByLabelText('دعاء'));
  expect(mockState.sendReaction).toHaveBeenCalledWith('dua');
  // The same pill closes the tray.
  await fireEvent.press(screen.getByLabelText('إغلاق التفاعل'));
  expect(screen.queryByLabelText('أعجبني')).toBeNull();
});

test('a guest is asked to register before reacting (guests listen only)', async () => {
  enter({ me: {}, meGender: 'm', user: { ...brother, isGuest: true } });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('تفاعل'));
  expect(screen.getByText('سجّل لتتفاعل مع المجلس')).toBeTruthy();
  expect(screen.queryByLabelText('أعجبني')).toBeNull();
});

test('stopped by a moderator: the tray says so and offers no signs', async () => {
  enter({ me: { reactBlocked: true }, meGender: 'm', user: brother });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('تفاعل'));
  expect(screen.getByText('أوقف المشرف تفاعلك في هذا المجلس')).toBeTruthy();
  expect(screen.queryByLabelText('أعجبني')).toBeNull();
});
