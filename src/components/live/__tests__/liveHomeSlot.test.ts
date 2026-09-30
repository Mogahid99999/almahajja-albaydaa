/**
 * Home's «أكمِل الاستماع» slot after a live (owner 2026-09-29): an ended live
 * must give the slot back even while get_live_now still answers «live» (the
 * room is deleted before the row's status is written).
 */
import type { LiveSessionPublic } from '@/api/live';

import { liveForHome } from '../useLiveHomeSlot';

// The hook's store (native audio underneath) is not needed for the pure rule.
jest.mock('@/stores/liveStore', () => ({ useLiveStore: jest.fn() }));

const live: LiveSessionPublic = {
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

test('a live the device knows nothing against takes the slot', () => {
  expect(liveForHome(live, new Set())).toBe(live);
  expect(liveForHome(null, new Set())).toBeNull();
  expect(liveForHome(undefined, new Set())).toBeNull();
});

test('seen ending here → the slot goes back, whatever the stale answer says', () => {
  expect(liveForHome(live, new Set(['s1']))).toBeNull();
  expect(liveForHome(live, new Set(['other']))).toBe(live);
});

test('an over status (from the answer or the session query cache) → the slot goes back', () => {
  expect(liveForHome({ ...live, status: 'ended' }, new Set())).toBeNull();
  expect(liveForHome(live, new Set(), () => 'processing')).toBeNull();
  expect(liveForHome(live, new Set(), () => 'live')).toBe(live);
});
