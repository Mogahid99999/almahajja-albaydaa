/**
 * Home's «أكمِل الاستماع» slot around a live (owner 2026-09-29: «عند انتهاء البث
 * بالصفحة الرئيسية يجب ان يرجع مربع اخر محاضرة كان يستمع لها الطالب»).
 *
 * Invariants:
 *  - while a live is on, «مباشر الآن» (LiveHomeCard) takes the slot;
 *  - once the live is over — the room ended here (store conn 'ended'), or the
 *    server says so — the slot shows the ContinueCard with the last lecture
 *    again, EVEN while get_live_now's cached answer still says «live» (the room
 *    is deleted before the row's status is written), and still after the
 *    «انتهى المجلس» mini-bar is dismissed;
 *  - get_live_now is asked again shortly after the end, and Home's data is
 *    refreshed when the slot flips back.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';

import { queryKeys } from '@/constants/queryKeys';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/audioController', () => ({ pause: jest.fn(), playLecture: jest.fn(), preloadLecture: jest.fn() }));
jest.mock('@/stores/playerStore', () => ({
  usePlayerStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ currentLectureId: null, isPlaying: false }),
}));

const mockLive: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockLive);
  useLiveStore.getState = () => mockLive;
  return { useLiveStore };
});

const liveSession = {
  id: 's1',
  sectionId: 'sec1',
  sectionTitle: 'العقيدة',
  sheikhId: 'sh1',
  sheikhName: 'الشيخ عبد الله',
  title: 'شرح كتاب التوحيد',
  status: 'live',
  scheduledAt: null,
  startedAt: '2026-09-29T18:00:00Z',
  endedAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
};
const mockLiveNow: { current: unknown } = { current: null };
jest.mock('@/hooks/useLive', () => ({
  useLiveNow: () => ({ data: mockLiveNow.current }),
}));
jest.mock('@/hooks/useSections', () => ({
  useHome: () => ({
    isLoading: false,
    data: {
      continueListening: {
        id: 'lec-7',
        title: 'الأصول الثلاثة · الدرس السابع',
        sheikhName: 'الشيخ عبد الله',
        eyebrow: 'أكمِل الاستماع',
        positionSec: 600,
        durationSec: 1800,
      },
      newlyAdded: [],
      featured: [],
      sections: [],
    },
  }),
}));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));
jest.mock('@/hooks/useRefreshAll', () => ({ useRefreshAll: () => jest.fn() }));

// Everything else on Home is out of scope here.
jest.mock('@/components/home/HomeHeader', () => ({ HomeHeader: () => null }));
jest.mock('@/components/home/GuestBanner', () => ({ GuestBanner: () => null }));
jest.mock('@/components/home/BroadcastCard', () => ({ BroadcastCard: () => null }));
jest.mock('@/components/home/NewlyAddedRail', () => ({ NewlyAddedRail: () => null }));
jest.mock('@/components/home/FeaturedRail', () => ({ FeaturedRail: () => null }));
jest.mock('@/components/home/StreakCard', () => ({ StreakCard: () => null }));
jest.mock('@/components/home/BuddyCard', () => ({ BuddyCard: () => null }));
jest.mock('@/components/home/BuddyGoalInvitesCard', () => ({ BuddyGoalInvitesCard: () => null }));
jest.mock('@/components/home/SectionsGrid', () => ({ SectionsGrid: () => null }));
jest.mock('@/components/home/QuestionsHomeCard', () => ({ QuestionsHomeCard: () => null }));
jest.mock('@/components/home/DuaCard', () => ({ DuaCard: () => null }));
jest.mock('@/components/journey/JourneyHomeCard', () => ({ JourneyHomeCard: () => null }));
jest.mock('@/components/SupportContactLink', () => ({ SupportContactLink: () => null }));
jest.mock('@/components/live/LiveUpcomingCard', () => ({ LiveUpcomingCard: () => null }));
jest.mock('@/components/home/ScheduleTodayCard', () => ({ ScheduleTodayCard: () => null }));

import { resetLiveHomeSlot } from '@/components/live/useLiveHomeSlot';
import HomeScreen from '../../app/(student)/index';

const CONTINUE = 'أكمِل الاستماع: الأصول الثلاثة · الدرس السابع';
const LIVE_CARD = 'بث مباشر: شرح كتاب التوحيد';

let qc: QueryClient;
function tree() {
  return (
    <QueryClientProvider client={qc}>
      <HomeScreen />
    </QueryClientProvider>
  );
}

function storeState(over: Record<string, unknown>) {
  for (const k of Object.keys(mockLive)) delete mockLive[k];
  Object.assign(mockLive, {
    session: null,
    conn: 'idle',
    people: {},
    activeSpeakers: [],
    counts: { brothers: 0, sisters: 0 },
    paused: false,
    ...over,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T18:40:00Z'));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetLiveHomeSlot();
  storeState({});
  mockLiveNow.current = { live: liveSession, upcoming: [], remindedIds: [], green: null };
});
afterEach(() => {
  jest.useRealTimers();
});

/** ContinueCard reads its dismissed-snapshot from AsyncStorage first. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

test('while the live is on, «مباشر الآن» holds the slot', async () => {
  storeState({ session: liveSession, conn: 'ok' });
  await render(tree());
  await settle();
  expect(screen.getByLabelText(LIVE_CARD)).toBeTruthy();
  expect(screen.queryByLabelText(CONTINUE)).toBeNull();
});

test('the room ended here while get_live_now still says «live» → the ContinueCard is back', async () => {
  const invalidate = jest.spyOn(qc, 'invalidateQueries');
  storeState({ session: liveSession, conn: 'ended' });
  await render(tree());
  await settle();
  expect(screen.queryByLabelText(LIVE_CARD)).toBeNull();
  expect(screen.getByLabelText(CONTINUE)).toBeTruthy();

  // get_live_now is asked again once the server has written 'ended'.
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.liveNow });
});

test('the «انتهى المجلس» bar dismissed (store cleared) with the answer still stale → still the ContinueCard', async () => {
  storeState({ session: liveSession, conn: 'ended' });
  const view = await render(tree());
  await settle();
  expect(screen.getByLabelText(CONTINUE)).toBeTruthy();

  storeState({}); // leave(): the mini-bar is gone
  await view.rerender(tree());
  await settle();
  expect(screen.queryByLabelText(LIVE_CARD)).toBeNull();
  expect(screen.getByLabelText(CONTINUE)).toBeTruthy();
});

test('a listener who left before the end: the server answer turns to «no live» → the ContinueCard, and Home is refreshed', async () => {
  const invalidate = jest.spyOn(qc, 'invalidateQueries');
  const view = await render(tree());
  await settle();
  expect(screen.getByLabelText(LIVE_CARD)).toBeTruthy();

  mockLiveNow.current = { live: null, upcoming: [], remindedIds: [], green: null };
  await view.rerender(tree());
  await settle();
  expect(screen.queryByLabelText(LIVE_CARD)).toBeNull();
  expect(screen.getByLabelText(CONTINUE)).toBeTruthy();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.home });
});
