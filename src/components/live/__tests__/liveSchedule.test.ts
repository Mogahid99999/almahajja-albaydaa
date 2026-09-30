/**
 * «متى يبدأ المجلس؟» — scheduling helpers (owner 2026-09-29: «الجدولة للبث لم
 * اجدها»). Local-time Date constructors keep every case timezone-agnostic.
 */
import {
  SCHEDULE_DAY_COUNT,
  defaultScheduleChoice,
  scheduleDate,
  scheduleDayLabel,
  scheduleDays,
  scheduleProblem,
  scheduledConfirmLine,
  to24h,
} from '../liveSchedule';

// Tuesday 29 September 2026, 14:07 local.
const NOW = new Date(2026, 8, 29, 14, 7).getTime();

test('day chips: «اليوم», «غداً», then weekday names with an Arabic date — 30 days', () => {
  const days = scheduleDays(NOW);
  expect(days).toHaveLength(SCHEDULE_DAY_COUNT);
  expect(days[0]).toEqual({ offset: 0, label: 'اليوم', date: '٢٩ سبتمبر' });
  expect(days[1]).toEqual({ offset: 1, label: 'غداً', date: '٣٠ سبتمبر' });
  expect(days[2]).toEqual({ offset: 2, label: 'الخميس', date: '١ أكتوبر' });
});

test('12-hour + ص/م → 24-hour', () => {
  expect(to24h(12, 'am')).toBe(0);
  expect(to24h(12, 'pm')).toBe(12);
  expect(to24h(8, 'pm')).toBe(20);
  expect(to24h(8, 'am')).toBe(8);
});

test('the default is about an hour ahead, on a quarter hour', () => {
  const c = defaultScheduleChoice(NOW);
  expect(c).toEqual({ dayOffset: 0, hour12: 3, minute: 15, period: 'pm' });
  expect(scheduleDate(c, NOW).getTime()).toBe(new Date(2026, 8, 29, 15, 15).getTime());
  // Late evening rolls to tomorrow.
  const late = defaultScheduleChoice(new Date(2026, 8, 29, 23, 20).getTime());
  expect(late).toEqual({ dayOffset: 1, hour12: 12, minute: 30, period: 'am' });
});

test('validation: at least 10 minutes ahead, at most 30 days', () => {
  expect(scheduleProblem(NOW + 5 * 60_000, NOW)).toBe('too_soon');
  expect(scheduleProblem(NOW - 60_000, NOW)).toBe('too_soon');
  expect(scheduleProblem(NOW + 10 * 60_000, NOW)).toBeNull();
  expect(scheduleProblem(NOW + 30 * 86_400_000, NOW)).toBeNull();
  expect(scheduleProblem(NOW + 30 * 86_400_000 + 60_000, NOW)).toBe('too_far');
  // The furthest chip (today + 29 days, 11:45 م) is always allowed.
  const last = scheduleDate({ dayOffset: SCHEDULE_DAY_COUNT - 1, hour12: 11, minute: 45, period: 'pm' }, NOW);
  expect(scheduleProblem(last.getTime(), NOW)).toBeNull();
});

test('the confirmation line: «جُدول المجلس: غداً ٨:٣٠ م، ويصل الطلاب تذكير قبل بدئه»', () => {
  const iso = new Date(2026, 8, 30, 20, 30).toISOString();
  expect(scheduledConfirmLine(iso, NOW)).toBe('جُدول المجلس: غداً ٨:٣٠ م، ويصل الطلاب تذكير قبل بدئه');
  const later = new Date(2026, 9, 2, 9, 0).toISOString();
  expect(scheduleDayLabel(later, NOW)).toBe('الجمعة ٢ أكتوبر');
});
