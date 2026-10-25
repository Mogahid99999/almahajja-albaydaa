/**
 * «ذكّرني قبل الدرس» (0158) — local notifications only (no server load): 15 min
 * before each HELD date of the lessons I chose, the single-date changes applied
 * (a cancelled date is not reminded, a postponed one is reminded at its new
 * time), capped so iOS's 64-pending limit is never hit; a re-plan replaces the
 * old ones (cancel first, then schedule).
 */
const mockCancel = jest.fn(async (_prefix: string) => undefined);
const mockScheduleAt = jest.fn(async (_id: string, _at: number, _c: unknown) => undefined);
jest.mock('@/lib/notifications', () => ({
  cancelLocalByPrefix: (p: string) => mockCancel(p),
  scheduleLocalAt: (id: string, at: number, c: unknown) => mockScheduleAt(id, at, c),
}));

import type { Schedule, ScheduleItem } from '@/api/schedule';
import { REMINDER_SPREAD_MS } from '@/stores/scheduleRemindersStore';
import { startMs } from '@/lib/schedule';
import {
  planScheduleReminders,
  REMINDER_LEAD_MS,
  REMINDER_MAX,
  syncScheduleReminders,
} from '@/lib/scheduleReminders';

const item = (over: Partial<ScheduleItem> & Pick<ScheduleItem, 'id' | 'days' | 'startTime'>): ScheduleItem => ({
  title: 'كتاب التوحيد',
  subtitle: null,
  subject: null,
  sheikhId: null,
  sheikhName: 'الشيخ النذير محمد',
  sectionId: null,
  sectionTitle: null,
  audience: 'all',
  durationMin: 60,
  note: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

// Monday 2026-10-05, 16:00 Mecca. A = Sunday + Thursday 21:30.
const NOW = startMs('2026-10-05', '16:00');
const A = item({ id: 'A', days: [0, 4], startTime: '21:30' });
const base: Schedule = { version: '1', items: [A], exceptions: [], canEdit: false };

test('nothing chosen → nothing planned', () => {
  expect(planScheduleReminders(base, [], NOW)).toEqual([]);
});

test('15 min before each held date; a cancelled one skipped, a postponed one at its new time', () => {
  const s: Schedule = {
    ...base,
    exceptions: [
      { id: 'e1', itemId: 'A', occursOn: '2026-10-08', kind: 'cancelled', newDate: null, newTime: null, note: null },
      { id: 'e2', itemId: 'A', occursOn: '2026-10-11', kind: 'moved', newDate: '2026-10-10', newTime: '20:00', note: null },
    ],
  };
  const plan = planScheduleReminders(s, ['A'], NOW);
  // 10 days from Monday 10-05 = up to 10-14: 10-08 cancelled, 10-11 → 10-10 20:00.
  expect(plan.map((r) => r.id)).toEqual(['sched:A:2026-10-10']);
  expect(plan[0].atMs).toBe(startMs('2026-10-10', '20:00') - REMINDER_LEAD_MS);
  expect(plan[0].title).toBe('بعد نحو ربع ساعة: كتاب التوحيد');
  expect(plan[0].body).toBe('الشيخ النذير محمد · ٨:٠٠ مساءً بتوقيت مكة');
});

test('a lesson starting too soon to remind is skipped', () => {
  const soon = item({ id: 'S', days: [1], startTime: '16:10' });
  expect(planScheduleReminders({ ...base, items: [soon] }, ['S'], NOW).map((r) => r.id)).toEqual([
    'sched:S:2026-10-12',
  ]);
});

test('LOAD V25: this install’s jitter adds 0–5 min of lead (capped) — phones are not woken together', () => {
  const at = (j: number) => planScheduleReminders(base, ['A'], NOW, j)[0].atMs;
  const start = startMs('2026-10-08', '21:30');
  expect(at(0)).toBe(start - REMINDER_LEAD_MS);
  expect(at(3 * 60_000)).toBe(start - REMINDER_LEAD_MS - 3 * 60_000);
  expect(at(60 * 60_000)).toBe(start - REMINDER_LEAD_MS - REMINDER_SPREAD_MS);
  expect(at(-5)).toBe(start - REMINDER_LEAD_MS);
});

test(`never more than ${REMINDER_MAX} pending (iOS keeps 64 for the whole app)`, () => {
  const daily = ['X', 'Y', 'Z'].map((id) => item({ id, days: [0, 1, 2, 3, 4, 5, 6], startTime: '20:00' }));
  expect(planScheduleReminders({ ...base, items: daily }, ['X', 'Y', 'Z'], NOW)).toHaveLength(REMINDER_MAX);
});

test('sync replaces: cancels the old «sched:» ones first, then schedules, opening the schedule', async () => {
  const order: string[] = [];
  mockCancel.mockImplementation(async () => {
    order.push('cancel');
  });
  mockScheduleAt.mockImplementation(async (id: string) => {
    order.push(id);
  });
  await syncScheduleReminders(base, ['A'], 0, NOW);
  expect(order[0]).toBe('cancel');
  expect(mockCancel).toHaveBeenCalledWith('sched:');
  expect(order.slice(1)).toEqual(['sched:A:2026-10-08', 'sched:A:2026-10-11']);
  expect(mockScheduleAt.mock.calls[0][2]).toMatchObject({ data: { route: '/(student)/schedule' } });
});
