/**
 * The host's whole end flow in the room (owner 2026-09-29: «احاول انهاء البث
 * ولا يقفل معي»): «مغادرة الحلقة» → EndSheet «إنهاء البث للجميع» → confirm →
 * the 5-second undo bar → endForAll() exactly once → «جارٍ إنهاء البث…» while
 * live-control `end` runs (~3 s on the server — the host used to see nothing
 * and think it failed) → a refusal is one Arabic line, never swallowed.
 * And `?end=1` (the host pressed the mini-bar's «×») opens EndSheet by itself.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCollapse = jest.fn();
jest.mock('@/components/live/LivePeekSheet', () => ({
  LivePeekSheet: ({ children }: { children: (c: () => void) => unknown }) => children(mockCollapse),
}));
jest.mock('@/components/live/Halaqa', () => ({ Halaqa: () => null }));
const mockParams: { current: Record<string, string> } = { current: { id: 's1' } };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams.current,
  useRouter: () => mockRouter,
}));

jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({
    data: { id: 'u-sh', role: 'sheikh', isGuest: false, displayName: 'الشيخ عبد الله', gender: 'male' },
  }),
  useUpdateProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));

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
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: session, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: [] }),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { LiveControlError } from '@/api/live';
import LiveRoomScreen from '../../app/live/[id]';

const ME = 'me-id';
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

function setup(role: 'host' | 'listener') {
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    session,
    conn: 'ok',
    me: { identity: ME, role, hidden: false, gender: 'm' },
    people: {
      [ME]: person(ME, { name: 'أنا', role, isMe: true, micOn: role === 'host' }),
      l1: person('l1', { name: 'خالد' }),
    },
    counts: { brothers: 2, sisters: 0 },
    activeSpeakers: [],
    hostPresent: true,
    paused: false,
    preferredIdentity: null,
    lastError: null,
    notice: null,
    micOn: role === 'host',
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
  jest.useFakeTimers();
  mockCollapse.mockReset();
  mockParams.current = { id: 's1' };
});
afterEach(() => {
  jest.useRealTimers();
});

async function confirmEnd() {
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
  expect(screen.getByText('يُحفظ التسجيل في قسم العقيدة')).toBeTruthy();
  await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
  expect(screen.getByText('ينتهي البث خلال ثوانٍ · تراجع')).toBeTruthy();
}

test('the host: confirm → 5 s undo → endForAll exactly once, «جارٍ إنهاء البث…» while it runs', async () => {
  setup('host');
  let finish: () => void = () => {};
  (mockState.endForAll as jest.Mock).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render(<LiveRoomScreen />);
  await confirmEnd();

  await act(async () => {
    jest.advanceTimersByTime(4999);
  });
  expect(mockState.endForAll).not.toHaveBeenCalled();
  expect(screen.queryByText('جارٍ إنهاء البث…')).toBeNull();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(mockState.endForAll).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('ينتهي البث خلال ثوانٍ · تراجع')).toBeNull();
  expect(screen.getByText('جارٍ إنهاء البث…')).toBeTruthy();

  await act(async () => {
    finish();
  });
  expect(screen.queryByText('جارٍ إنهاء البث…')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  expect(mockState.endForAll).toHaveBeenCalledTimes(1);
  expect(mockState.leave).not.toHaveBeenCalled();
});

test('endForAll rejected → an Arabic error line, not swallowed', async () => {
  setup('host');
  (mockState.endForAll as jest.Mock).mockRejectedValue(new LiveControlError('forbidden'));
  await render(<LiveRoomScreen />);
  await confirmEnd();
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(mockState.endForAll).toHaveBeenCalledTimes(1);
  expect(screen.getByText('لا تملك صلاحية هذا الإجراء')).toBeTruthy();
  expect(screen.queryByText('جارٍ إنهاء البث…')).toBeNull();
});

test('`?end=1` (the mini-bar «×» of the host) opens «مغادرة الحلقة» by itself', async () => {
  setup('host');
  mockParams.current = { id: 's1', end: '1' };
  await render(<LiveRoomScreen />);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(screen.getByText('إنهاء البث للجميع')).toBeTruthy();
  expect(screen.getByText('البقاء في الحلقة')).toBeTruthy();
  expect(mockState.endForAll).not.toHaveBeenCalled();
});

test('`?end=1` does nothing for a listener', async () => {
  setup('listener');
  mockParams.current = { id: 's1', end: '1' };
  await render(<LiveRoomScreen />);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(screen.queryByText('إنهاء البث للجميع')).toBeNull();
  expect(screen.queryByText('البقاء في الحلقة')).toBeNull();
});
