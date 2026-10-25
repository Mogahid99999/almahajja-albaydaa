/**
 * src/api/appOpen.ts — app_open (0156) is ONE rpc, and its jsonb is
 * shape-checked: anything but a literal true never signs anyone out or flips a flag.
 */
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('@/config', () => ({ USE_MOCK: false }));

import { appOpen, parseAppOpen } from '@/api/appOpen';

beforeEach(() => mockRpc.mockReset());

test('one rpc call, no arguments', async () => {
  mockRpc.mockResolvedValue({ data: { user_exists: true }, error: null });
  await appOpen();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('app_open');
});

test('a server error is thrown (the caller backs off), not turned into a sign-out', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: '503' } });
  await expect(appOpen()).rejects.toEqual({ message: '503' });
});

test('maps the payload; blanks become null', () => {
  expect(
    parseAppOpen({
      user_exists: true,
      banned: false,
      unread: 3,
      latest_notification_at: '2026-10-05T08:00:00Z',
      buddy: { incoming: 1, outgoing: 2, goal_invites: 3 },
      daily_reminder: true,
      has_resumable: true,
      live: { live: null },
      version: { min_app_version: '1.0.0', app_download_url: '', latest_app_version: '1.1.4', latest_released_at: '' },
      schedule_version: '1791180000000',
    }),
  ).toEqual({
    userExists: true,
    banned: false,
    unread: 3,
    latestNotificationAt: '2026-10-05T08:00:00Z',
    buddy: { incoming: 1, outgoing: 2, goalInvites: 3 },
    dailyReminder: true,
    hasResumable: true,
    live: { live: null },
    version: { minVersion: '1.0.0', downloadUrl: null, latestVersion: '1.1.4', latestReleasedAt: null },
    scheduleVersion: '1791180000000',
  });
});

test('fail safe: only a literal true bans / flips flags; garbage is not a payload', () => {
  const r = parseAppOpen({ user_exists: true, banned: 'true', daily_reminder: 1, has_resumable: 'yes', unread: '5' })!;
  expect([r.banned, r.dailyReminder, r.hasResumable, r.unread]).toEqual([false, false, false, 0]);
  expect(parseAppOpen(null)).toBeNull();
  expect(parseAppOpen([])).toBeNull();
  expect(parseAppOpen({ user_exists: false })?.userExists).toBe(false);
});
