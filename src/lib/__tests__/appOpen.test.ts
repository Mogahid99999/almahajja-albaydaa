/**
 * LOAD V24 — one app_open RPC per foreground (0156) instead of 8–12 requests,
 * at most every 15 min, and only the parts that changed are refetched.
 */
const mockAppOpen = jest.fn();
jest.mock('@/api/appOpen', () => {
  const actual = jest.requireActual('@/api/appOpen');
  return { ...actual, appOpen: () => mockAppOpen() };
});
const mockSchedule = jest.fn(async () => undefined);
const mockCancel = jest.fn(async () => undefined);
jest.mock('@/lib/notifications', () => ({
  scheduleDailyReminder: () => mockSchedule(),
  cancelDailyReminder: () => mockCancel(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { parseAppOpen, type AppOpenResult } from '@/api/appOpen';
import { queryKeys } from '@/constants/queryKeys';
import {
  __resetAppOpenForTests,
  APP_OPEN_MIN_INTERVAL_MS,
  APP_OPEN_RETRY_AFTER_FAILURE_MS,
  BUDDY_OPEN_COUNTS_KEY,
  decideAppOpenEffects,
  isBroadcastPush,
  runAppOpen,
} from '@/lib/appOpen';
import { queryClient } from '@/lib/queryClient';

const RAW = {
  user_exists: true,
  banned: false,
  unread: 2,
  latest_notification_at: '2026-10-05T08:00:00Z',
  buddy: { incoming: 1, outgoing: 0, goal_invites: 0 },
  daily_reminder: false,
  has_resumable: false,
  live: { live: null, upcoming: [], green: null },
  version: { min_app_version: '1.0.0', app_download_url: '', latest_app_version: '1.1.4', latest_released_at: '2026-10-05' },
};
const result = (over: Partial<typeof RAW> = {}): AppOpenResult => parseAppOpen({ ...RAW, ...over })!;
const view = (over = {}) => ({
  newestCachedNotificationAt: '2026-10-05T08:00:00Z',
  cachedUnread: 2,
  prevBuddy: { incoming: 1, outgoing: 0, goalInvites: 0 },
  ...over,
});

describe('decideAppOpenEffects (pure)', () => {
  test('nothing changed → nothing refetched', () => {
    expect(decideAppOpenEffects(result(), view())).toEqual({
      signOut: false,
      refetchInbox: false,
      refetchBuddy: false,
      scheduleDailyReminder: false,
      refetchSchedule: false,
    });
  });

  test('0158: the weekly schedule is refetched only when its version moved (and a copy exists)', () => {
    const r = parseAppOpen({ ...RAW, schedule_version: '200' })!;
    expect(decideAppOpenEffects(r, view({ cachedScheduleVersion: '100' })).refetchSchedule).toBe(true);
    expect(decideAppOpenEffects(r, view({ cachedScheduleVersion: '200' })).refetchSchedule).toBe(false);
    expect(decideAppOpenEffects(r, view({ cachedScheduleVersion: null })).refetchSchedule).toBe(false);
  });

  test('banned or deleted account → sign out and nothing else (was the GoTrue /user check)', () => {
    expect(decideAppOpenEffects(result({ banned: true }), view()).signOut).toBe(true);
    expect(decideAppOpenEffects(parseAppOpen({ user_exists: false })!, view()).signOut).toBe(true);
  });

  test('a newer inbox item → refetch the inbox', () => {
    expect(decideAppOpenEffects(result({ latest_notification_at: '2026-10-05T09:00:00Z' }), view()).refetchInbox).toBe(true);
  });

  test('read elsewhere (none ↔ some unread) → refetch the inbox; 50-item cache vs server count does not', () => {
    expect(decideAppOpenEffects(result({ unread: 0 }), view({ cachedUnread: 3 })).refetchInbox).toBe(true);
    expect(decideAppOpenEffects(result({ unread: 120 }), view({ cachedUnread: 50 })).refetchInbox).toBe(false);
  });

  test('no inbox cached yet → leave it to the inbox query itself', () => {
    expect(decideAppOpenEffects(result(), view({ newestCachedNotificationAt: null, cachedUnread: null })).refetchInbox).toBe(false);
  });

  test('a buddy count moved → refetch buddy state; first run ever → no blind refetch', () => {
    expect(decideAppOpenEffects(result({ buddy: { incoming: 2, outgoing: 0, goal_invites: 0 } }), view()).refetchBuddy).toBe(true);
    expect(decideAppOpenEffects(result(), view({ prevBuddy: null })).refetchBuddy).toBe(false);
  });

  test('§7: the daily remembrance only when on AND no lesson is in progress', () => {
    expect(decideAppOpenEffects(result({ daily_reminder: true }), view()).scheduleDailyReminder).toBe(true);
    expect(decideAppOpenEffects(result({ daily_reminder: true, has_resumable: true }), view()).scheduleDailyReminder).toBe(false);
  });
});

test('broadcast pushes (lesson / file / live) are recognised; personal ones are not', () => {
  expect(isBroadcastPush({ lectureId: 'l1' })).toBe(true);
  expect(isBroadcastPush({ sectionId: 's1' })).toBe(true);
  expect(isBroadcastPush({ route: '/live/abc' })).toBe(true);
  // 0158: the local lesson reminder — no server state changed, refetch nothing.
  expect(isBroadcastPush({ route: '/(student)/schedule' })).toBe(true);
  expect(isBroadcastPush({ route: '/' })).toBe(false);
  expect(isBroadcastPush({ route: '/(student)/questions' })).toBe(false);
  expect(isBroadcastPush({})).toBe(false);
});

describe('runAppOpen', () => {
  beforeEach(() => {
    __resetAppOpenForTests();
    queryClient.clear();
    mockAppOpen.mockReset();
    mockSchedule.mockClear();
    mockCancel.mockClear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-05T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  test('one RPC per 15 min of foregrounds; the cold start is forced', async () => {
    mockAppOpen.mockResolvedValue(result());
    const onSignedOut = jest.fn();
    await runAppOpen({ force: true, onSignedOut });
    await runAppOpen({ onSignedOut });
    jest.setSystemTime(Date.now() + APP_OPEN_MIN_INTERVAL_MS - 1000);
    await runAppOpen({ onSignedOut });
    expect(mockAppOpen).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 2000);
    await runAppOpen({ onSignedOut });
    expect(mockAppOpen).toHaveBeenCalledTimes(2);
  });

  test('a failed call retries no sooner than 2 min later — never in a loop', async () => {
    mockAppOpen.mockRejectedValueOnce(new Error('503')).mockResolvedValue(result());
    const onSignedOut = jest.fn();
    await runAppOpen({ force: false, onSignedOut });
    await runAppOpen({ onSignedOut });
    expect(mockAppOpen).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + APP_OPEN_RETRY_AFTER_FAILURE_MS);
    await runAppOpen({ onSignedOut });
    expect(mockAppOpen).toHaveBeenCalledTimes(2);
  });

  test('seeds the live card, the version gate and the buddy counts — no separate fetches', async () => {
    mockAppOpen.mockResolvedValue(result());
    await runAppOpen({ force: true, onSignedOut: jest.fn() });
    expect(queryClient.getQueryData(queryKeys.liveNow)).toEqual({ live: null, upcoming: [], remindedIds: [], green: null });
    expect(queryClient.getQueryData(['appVersionGate'])).toEqual({
      minVersion: '1.0.0',
      downloadUrl: null,
      latestVersion: '1.1.4',
      latestReleasedAt: '2026-10-05',
    });
    expect(queryClient.getQueryData(BUDDY_OPEN_COUNTS_KEY)).toEqual({ incoming: 1, outgoing: 0, goalInvites: 0 });
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  test('a banned account runs the forced sign-out and seeds nothing', async () => {
    mockAppOpen.mockResolvedValue(result({ banned: true }));
    const onSignedOut = jest.fn();
    await runAppOpen({ force: true, onSignedOut });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.liveNow)).toBeUndefined();
  });

  test('a changed buddy count invalidates buddy state but keeps its own counts entry', async () => {
    queryClient.setQueryData(BUDDY_OPEN_COUNTS_KEY, { incoming: 0, outgoing: 0, goalInvites: 0 });
    queryClient.setQueryData(queryKeys.buddyRequests, []);
    mockAppOpen.mockResolvedValue(result());
    await runAppOpen({ force: true, onSignedOut: jest.fn() });
    expect(queryClient.getQueryState(queryKeys.buddyRequests)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(BUDDY_OPEN_COUNTS_KEY)?.isInvalidated).toBe(false);
  });
});
