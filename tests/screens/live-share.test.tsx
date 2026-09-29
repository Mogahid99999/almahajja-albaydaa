/**
 * «مشاركة رابط البث» (V23 P5, §9.3 / §15 share, D8).
 *
 * Pins: the room's top bar opens ShareSheet for a live session; the sheet shows
 * the §15 copy and the go.almahajja.app link, and «مشاركة» hands the system
 * share sheet the §9.3 message exactly; «ادعُ رفيقك إلى الحلقة» appears only for
 * a registered listener who has buddies (guests have none).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

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

const mockBuddies: { current: { buddyId: string; displayName: string }[] } = { current: [] };
const mockUseMyBuddies = jest.fn((_o?: { enabled?: boolean }) => ({ data: mockBuddies.current }));
jest.mock('@/hooks/useBuddy', () => ({
  useMyBuddies: (o?: { enabled?: boolean }) => mockUseMyBuddies(o),
}));

const mockSession: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession.current, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: [] }),
  useLiveBuddiesPresent: () => ({ data: [] }),
  useLiveInvited: () => ({ data: [] }),
  useInviteBuddyToLive: () => ({ mutate: jest.fn(), isPending: false }),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { ShareSheet } from '@/components/live/sheets/ShareSheet';
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

const EXPECTED_MESSAGE =
  'يُبث الآن: شرح كتاب التوحيد · العقيدة، مع الشيخ عبد الله.\nاستمع في المحجّة البيضاء:\nhttps://go.almahajja.app/live/ABC234';

let shareSpy: jest.SpyInstance;
beforeEach(() => {
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  mockBuddies.current = [];
  mockUseMyBuddies.mockClear();
  mockSession.current = liveSession;
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  Object.assign(mockState, {
    session: liveSession,
    conn: 'ok',
    me: { identity: 'a'.repeat(16), role: 'listener', hidden: false, gender: 'm' },
    people: {},
    counts: { brothers: 1, sisters: 0 },
    activeSpeakers: [],
    hostPresent: true,
    paused: false,
    preferredIdentity: null,
    lastError: null,
    join: jest.fn(() => Promise.resolve()),
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
    setAllowRequests: jest.fn(() => Promise.resolve()),
    handOver: jest.fn(() => Promise.resolve()),
    endForAll: jest.fn(() => Promise.resolve()),
    clearNotice: jest.fn(),
  });
});
afterEach(() => {
  shareSpy.mockRestore();
});

describe('ShareSheet', () => {
  test('§15 copy, the go.almahajja.app link, and the §9.3 message', async () => {
    await render(<ShareSheet visible onClose={jest.fn()} session={liveSession} />);
    expect(screen.getByText('مشاركة رابط البث')).toBeTruthy();
    expect(screen.getByText('من لديه التطبيق يدخل الحلقة مباشرة، ومن ليس لديه يُوجَّه إلى متجر جهازه.')).toBeTruthy();
    expect(screen.getByText('go.almahajja.app/live/ABC234')).toBeTruthy();

    await fireEvent.press(screen.getByText('مشاركة'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy.mock.calls[0][0]).toEqual({ message: EXPECTED_MESSAGE });
  });

  test('a completed share closes the sheet', async () => {
    shareSpy.mockResolvedValue({ action: Share.sharedAction });
    const onClose = jest.fn();
    await render(<ShareSheet visible onClose={onClose} session={liveSession} />);
    await fireEvent.press(screen.getByText('مشاركة'));
    await act(async () => {});
    expect(onClose).toHaveBeenCalled();
  });

  test('guests: no buddy invite (and no buddy query)', async () => {
    mockBuddies.current = [{ buddyId: 'b1', displayName: 'حسن' }];
    await render(
      <ShareSheet visible onClose={jest.fn()} session={liveSession} canInvite={false} onInvite={jest.fn()} />,
    );
    expect(screen.queryByText('ادعُ رفيقك إلى الحلقة')).toBeNull();
    expect(mockUseMyBuddies).toHaveBeenCalledWith({ enabled: false });
  });

  test('registered with buddies: «ادعُ رفيقك إلى الحلقة» opens the invite', async () => {
    mockBuddies.current = [{ buddyId: 'b1', displayName: 'حسن' }];
    const onInvite = jest.fn();
    await render(
      <ShareSheet visible onClose={jest.fn()} session={liveSession} canInvite gender="m" onInvite={onInvite} />,
    );
    await fireEvent.press(screen.getByText('ادعُ رفيقك إلى الحلقة'));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  test('registered without buddies: no invite row', async () => {
    await render(
      <ShareSheet visible onClose={jest.fn()} session={liveSession} canInvite gender="f" onInvite={jest.fn()} />,
    );
    expect(screen.queryByText('ادعي رفيقتك إلى الحلقة')).toBeNull();
  });
});

describe('the room', () => {
  test('the top-bar share icon opens «مشاركة رابط البث»', async () => {
    await render(<LiveRoomScreen />);
    expect(screen.queryByText('go.almahajja.app/live/ABC234')).toBeNull();
    await fireEvent.press(screen.getByLabelText('مشاركة رابط البث'));
    expect(screen.getByText('go.almahajja.app/live/ABC234')).toBeTruthy();
  });

  test('share → «ادعُ رفيقك إلى الحلقة» → the invite sheet', async () => {
    mockBuddies.current = [{ buddyId: 'b1', displayName: 'حسن' }];
    jest.useFakeTimers();
    try {
      await render(<LiveRoomScreen />);
      await fireEvent.press(screen.getByLabelText('مشاركة رابط البث'));
      await fireEvent.press(screen.getByText('ادعُ رفيقك إلى الحلقة'));
      await act(async () => {
        jest.advanceTimersByTime(500); // iOS: the share sheet dismisses first
      });
      expect(screen.getByText('رفيقك حسن ليس في الحلقة')).toBeTruthy();
      expect(screen.getByText('ادعُه')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('no share icon once the session is over', async () => {
    mockSession.current = { ...liveSession, status: 'ended' };
    await render(<LiveRoomScreen />);
    expect(screen.queryByLabelText('مشاركة رابط البث')).toBeNull();
  });
});
