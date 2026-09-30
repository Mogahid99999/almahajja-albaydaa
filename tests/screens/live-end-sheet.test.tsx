/**
 * «مغادرة الحلقة» for the host / moderators (V23 P4, PLAN_LIVE_V23 §7.6, §15 end).
 *
 * Invariants: «أغادر ويستمر البث» is offered to the host only when another
 * moderator is present (one → handOver at once, several → a picker), and to a
 * moderator as a plain leave; «إنهاء البث للجميع» only to the host or a content
 * manager (admin/publisher). Ending always goes choice → confirm (naming the
 * section the recording goes to) → a 5-second undo bar; only after the 5 s does
 * endForAll() run — «تراجع» or leaving the screen cancels it for good.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCollapse = jest.fn();
jest.mock('@/components/live/LivePeekSheet', () => ({
  LivePeekSheet: ({ children }: { children: (c: () => void) => unknown }) => children(mockCollapse),
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

const mockSession: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession.current, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: [] }),
}));
// «التعليقات والأسئلة» has its own screen test (live-comments) — an empty list here.
jest.mock('@/hooks/useLiveComments', () => ({
  useLiveComments: () => ({ comments: [], isLoading: false, isError: false, refetch: jest.fn(), unseen: 0 }),
  usePostLiveComment: () => ({ mutate: jest.fn(), isPending: false }),
  useLiveCommentAction: () => ({ mutate: jest.fn(), isPending: false, variables: undefined }),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { LiveControlError } from '@/api/live';
import LiveRoomScreen from '../../app/live/[id]';

const session = {
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

function person(id: string, over: Record<string, unknown>) {
  return {
    identity: id,
    name: 'مستمع',
    gender: 'm',
    role: 'listener',
    hidden: false,
    hand: false,
    handAt: null,
    micOn: false,
    speaking: false,
    isMe: false,
    ...over,
  };
}

const ME = 'me-id';
const SHEIKH = { id: 'u-sh', role: 'sheikh', isGuest: false, displayName: 'الشيخ عبد الله', gender: 'male' };

function setup(role: 'host' | 'moderator', extraPeople: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    session,
    conn: 'ok',
    me: { identity: ME, role, hidden: false, gender: 'm' },
    people: {
      [ME]: person(ME, { name: 'أنا', role, isMe: true, micOn: true }),
      l1: person('l1', { name: 'خالد' }),
      ...extraPeople,
    },
    counts: { brothers: 2, sisters: 0 },
    activeSpeakers: [],
    hostPresent: true,
    paused: false,
    preferredIdentity: null,
    lastError: null,
    notice: null,
    micOn: true,
    handBusy: false,
    micBusy: false,
    allowRequests: true,
    join: jest.fn(),
    leave: jest.fn(() => Promise.resolve()),
    setPaused: jest.fn(),
    setPreferredIdentity: jest.fn(),
    raiseHand: jest.fn(),
    lowerHand: jest.fn(),
    setMic: jest.fn(),
    stepDown: jest.fn(),
    moderate: jest.fn(),
    setAllowRequests: jest.fn(),
    handOver: jest.fn(() => Promise.resolve()),
    endForAll: jest.fn(() => Promise.resolve()),
    clearNotice: jest.fn(),
  });
}

beforeEach(() => {
  mockCollapse.mockReset();
  mockSession.current = session;
  mockUser.current = SHEIKH;
});

/** Leave → «إنهاء البث للجميع» → confirm → the undo bar is up. */
async function endWithUndo() {
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
  expect(screen.getByText('إنهاء البث للجميع؟')).toBeTruthy();
  expect(screen.getByText('يُحفظ التسجيل في قسم العقيدة')).toBeTruthy();
  await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
  expect(screen.getByText('ينتهي البث خلال ثوانٍ · تراجع')).toBeTruthy();
}

describe('the host, alone on the floor', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('only «إنهاء البث للجميع» — «أغادر ويستمر البث» needs another moderator', async () => {
    setup('host');
    await render(<LiveRoomScreen />);
    await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
    expect(screen.getByText('إنهاء البث للجميع')).toBeTruthy();
    expect(screen.queryByText('أغادر ويستمر البث')).toBeNull();
    expect(screen.getByText('لا يوجد مشرف آخر في الحلقة ليستمر البث بعدك.')).toBeTruthy();
    expect(mockState.leave).not.toHaveBeenCalled(); // leave never skips the choice
  });

  test('confirm → undo: «تراجع» cancels — endForAll never runs', async () => {
    setup('host');
    await render(<LiveRoomScreen />);
    await endWithUndo();
    await fireEvent.press(screen.getByText('ينتهي البث خلال ثوانٍ · تراجع'));
    expect(screen.queryByText('ينتهي البث خلال ثوانٍ · تراجع')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mockState.endForAll).not.toHaveBeenCalled();
    expect(mockState.leave).not.toHaveBeenCalled();
  });

  test('confirm → the 5 s pass → endForAll() once', async () => {
    setup('host');
    await render(<LiveRoomScreen />);
    await endWithUndo();
    await act(async () => {
      jest.advanceTimersByTime(4900);
    });
    expect(mockState.endForAll).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockState.endForAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('ينتهي البث خلال ثوانٍ · تراجع')).toBeNull();
  });

  test('leaving the screen during the undo ends at once — only «تراجع» cancels (P4 review: a minimised room must not keep broadcasting)', async () => {
    setup('host');
    const { unmount } = await render(<LiveRoomScreen />);
    await endWithUndo();
    expect(mockState.endForAll).not.toHaveBeenCalled();
    await act(async () => {
      await unmount();
    });
    expect(mockState.endForAll).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mockState.endForAll).toHaveBeenCalledTimes(1);
  });

  test('a failed end shows an Arabic line', async () => {
    setup('host');
    (mockState.endForAll as jest.Mock).mockRejectedValue(new LiveControlError('network'));
    await render(<LiveRoomScreen />);
    await endWithUndo();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByText('تعذّر الاتصال. تحقّق من الشبكة ثم حاول مرة أخرى')).toBeTruthy();
  });
});

test('host + one moderator: «أغادر ويستمر البث» hands over to them and closes', async () => {
  setup('host', { m2: person('m2', { name: 'أبو محمد', role: 'moderator' }) });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(screen.getByText('يتولّى أبو محمد إدارة المجلس')).toBeTruthy();
  await fireEvent.press(screen.getByText('أغادر ويستمر البث'));
  await act(async () => {});
  expect(mockState.handOver).toHaveBeenCalledWith('m2');
  expect(mockCollapse).toHaveBeenCalled();
  expect(mockState.endForAll).not.toHaveBeenCalled();
});

test('host + several moderators: pick who runs it', async () => {
  setup('host', {
    m2: person('m2', { name: 'أبو محمد', role: 'moderator' }),
    m3: person('m3', { name: 'أبو عبد الرحمن', role: 'moderator' }),
  });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  await fireEvent.press(screen.getByText('أغادر ويستمر البث'));
  expect(screen.getByText('من يدير البث بعدك؟')).toBeTruthy();
  expect(mockState.handOver).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('أبو عبد الرحمن'));
  await act(async () => {});
  expect(mockState.handOver).toHaveBeenCalledWith('m3');
});

test('a hand-over refused → the reason in Arabic, the host stays', async () => {
  setup('host', { m2: person('m2', { name: 'أبو محمد', role: 'moderator' }) });
  (mockState.handOver as jest.Mock).mockRejectedValue(new LiveControlError('no_moderator_present'));
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  await fireEvent.press(screen.getByText('أغادر ويستمر البث'));
  await act(async () => {});
  expect(screen.getByText('لا يوجد مشرف آخر في الحلقة الآن')).toBeTruthy();
  expect(mockCollapse).not.toHaveBeenCalled();
});

test('a sheikh moderating (not host): a plain leave, no «إنهاء البث للجميع»', async () => {
  setup('moderator', { host: person('host', { name: 'الشيخ', role: 'host' }) });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(screen.queryByText('إنهاء البث للجميع')).toBeNull();
  await fireEvent.press(screen.getByText('أغادر ويستمر البث'));
  expect(mockState.leave).toHaveBeenCalledTimes(1);
  expect(mockCollapse).toHaveBeenCalled();
  expect(mockState.handOver).not.toHaveBeenCalled();
});

test('an admin moderating may also end it for everyone', async () => {
  mockUser.current = { id: 'u-ad', role: 'admin', isGuest: false, displayName: 'المدير', gender: 'male' };
  setup('moderator', { host: person('host', { name: 'الشيخ', role: 'host' }) });
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(screen.getByText('أغادر ويستمر البث')).toBeTruthy();
  expect(screen.getByText('إنهاء البث للجميع')).toBeTruthy();
});
