/**
 * LOAD V24 — get_live_now was polled every 30 s by every foreground app on any
 * screen. Now: only on a focused screen, 60 s while something is live or due
 * within 2 h, 10 min otherwise.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/stores/liveStore', () => ({ useLiveStore: jest.fn(), notifyLiveSessionEnded: jest.fn() }));

import type { LiveNow } from '@/api/live';
import {
  LIVE_NOW_ACTIVE_POLL_MS,
  LIVE_NOW_IDLE_POLL_MS,
  LIVE_SESSION_JOINING_POLL_MS,
  liveNowPollMs,
  liveSessionPollMs,
} from '@/hooks/useLive';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const base: LiveNow = { live: null, upcoming: [], remindedIds: [], green: null };
const scheduled = (iso: string) => ({ id: 's1', scheduledAt: iso }) as unknown as LiveNow['upcoming'][number];

test('nothing live, nothing soon → every 10 minutes', () => {
  expect(liveNowPollMs(base, NOW)).toBe(LIVE_NOW_IDLE_POLL_MS);
  expect(liveNowPollMs(undefined, NOW)).toBe(LIVE_NOW_IDLE_POLL_MS);
  expect(liveNowPollMs({ ...base, upcoming: [scheduled('2026-10-05T15:00:00Z')] }, NOW)).toBe(LIVE_NOW_IDLE_POLL_MS);
});

test('a live session, or one due within 2 h (or overdue) → every minute', () => {
  expect(liveNowPollMs({ ...base, live: { id: 'x' } as LiveNow['live'] }, NOW)).toBe(LIVE_NOW_ACTIVE_POLL_MS);
  expect(liveNowPollMs({ ...base, upcoming: [scheduled('2026-10-05T11:30:00Z')] }, NOW)).toBe(LIVE_NOW_ACTIVE_POLL_MS);
  expect(liveNowPollMs({ ...base, upcoming: [scheduled('2026-10-05T09:50:00Z')] }, NOW)).toBe(LIVE_NOW_ACTIVE_POLL_MS);
});

test('never faster than once a minute (was 30 s)', () => {
  expect(LIVE_NOW_ACTIVE_POLL_MS).toBeGreaterThanOrEqual(60_000);
});

test('room session poll: 10 s only while this device is still joining, 90 s in the room, off once over', () => {
  expect(liveSessionPollMs('live', true)).toBe(LIVE_SESSION_JOINING_POLL_MS);
  expect(LIVE_SESSION_JOINING_POLL_MS).toBe(10_000);
  expect(liveSessionPollMs('live', false)).toBe(90_000);
  expect(liveSessionPollMs(undefined, true)).toBe(LIVE_SESSION_JOINING_POLL_MS);
  expect(liveSessionPollMs('processing', true)).toBe(false);
  expect(liveSessionPollMs('ended', false)).toBe(false);
});
