/**
 * /admin/schedule pure parts (0158): the form says why in Arabic before the
 * server refuses (limits mirror the 0158 table checks); time is 24-hour Mecca
 * time and Arabic-Indic digits are accepted; only the dates a lesson is held
 * on can be changed alone; a saved change prefills the date form.
 */
import type { ScheduleException, ScheduleItem } from '@/api/schedule';
import {
  changeDraft,
  draftFromItem,
  exceptionLine,
  itemDates,
  normalizeHM,
  sortForAdmin,
  upcomingExceptions,
  validateItemDraft,
  type ItemDraft,
} from '@/components/admin/schedule/scheduleAdminUi';

const item = (over: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'A',
  title: 'كتاب التوحيد',
  subtitle: null,
  subject: null,
  sheikhId: null,
  sheikhName: null,
  sectionId: null,
  sectionTitle: null,
  audience: 'all',
  days: [0, 4],
  startTime: '21:30',
  durationMin: 60,
  note: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

const draft = (over: Partial<ItemDraft> = {}): ItemDraft => ({ ...draftFromItem(null), title: 'كتاب التوحيد', days: [4], time: '21:30', ...over });

test('time: 24-hour, padded; Arabic-Indic digits and «.» accepted; nonsense refused', () => {
  expect(normalizeHM('21:30')).toBe('21:30');
  expect(normalizeHM('9:05')).toBe('09:05');
  expect(normalizeHM('٢١:٣٠')).toBe('21:30');
  expect(normalizeHM('21.30')).toBe('21:30');
  expect(normalizeHM('24:00')).toBeNull();
  expect(normalizeHM('9pm')).toBeNull();
  expect(normalizeHM('')).toBeNull();
});

test('the form names what is missing, in Arabic', () => {
  expect(validateItemDraft(draft({ title: ' ' }))).toEqual({ ok: false, error: 'اكتب عنوان الدرس.' });
  expect(validateItemDraft(draft({ days: [] }))).toEqual({ ok: false, error: 'اختر يوماً واحداً على الأقل.' });
  expect(validateItemDraft(draft({ time: '9 مساءً' }))).toEqual({
    ok: false,
    error: 'اكتب الوقت بنظام ٢٤ ساعة بتوقيت مكة، مثل 21:30.',
  });
  expect(validateItemDraft(draft({ duration: '2' }))).toEqual({
    ok: false,
    error: 'المدة بالدقائق بين ٥ و٦٠٠، أو اتركها فارغة.',
  });
});

test('a valid draft becomes the input: trimmed, days sorted, empty → null, a sheikhs row wins over the free name', () => {
  const r = validateItemDraft(draft({ title: ' كتاب التوحيد ', days: [4, 0], time: '٩:٠٥', duration: '', sheikhId: 'sh1', sheikhName: 'x' }));
  expect(r).toEqual({
    ok: true,
    input: expect.objectContaining({
      title: 'كتاب التوحيد',
      days: [0, 4],
      startTime: '09:05',
      durationMin: null,
      subtitle: null,
      sheikhId: 'sh1',
      sheikhName: null,
    }),
  });
});

test('editing round-trips an item into the form', () => {
  const r = validateItemDraft(draftFromItem(item({ sheikhName: 'شيخ زائر', durationMin: 45 })));
  expect(r.ok && r.input).toMatchObject({ id: 'A', sheikhName: 'شيخ زائر', durationMin: 45, startTime: '21:30' });
});

test('only the dates the lesson is held on can be changed alone', () => {
  // Monday 2026-10-05: the next Sundays / Thursdays.
  expect(itemDates(item(), '2026-10-05', 14)).toEqual(['2026-10-08', '2026-10-11', '2026-10-15', '2026-10-18']);
});

test('a saved change reads plainly, and prefills the date form', () => {
  const cancelled: ScheduleException = { id: 'e1', itemId: 'A', occursOn: '2026-10-08', kind: 'cancelled', newDate: null, newTime: null, note: 'لسفر الشيخ' };
  const moved: ScheduleException = { id: 'e2', itemId: 'A', occursOn: '2026-10-11', kind: 'moved', newDate: '2026-10-10', newTime: '20:00', note: null };
  const retimed: ScheduleException = { id: 'e3', itemId: 'A', occursOn: '2026-10-15', kind: 'moved', newDate: '2026-10-15', newTime: '22:00', note: null };
  expect(exceptionLine(cancelled, item())).toBe('الخميس ٨ أكتوبر — أُلغي (لسفر الشيخ)');
  expect(exceptionLine(moved, item())).toBe('الأحد ١١ أكتوبر — أُجّل إلى السبت ١٠ أكتوبر ٨:٠٠ مساءً');
  expect(exceptionLine(retimed, item())).toBe('الخميس ١٥ أكتوبر — الوقت ١٠:٠٠ مساءً');
  expect(changeDraft(item(), cancelled)).toEqual({ kind: 'cancel', newDate: null, time: '21:30', note: 'لسفر الشيخ' });
  expect(changeDraft(item(), moved)).toEqual({ kind: 'postpone', newDate: '2026-10-10', time: '20:00', note: '' });
  expect(changeDraft(item(), retimed)).toMatchObject({ kind: 'time', newDate: null, time: '22:00' });
  expect(changeDraft(item(), null)).toEqual({ kind: 'cancel', newDate: null, time: '21:30', note: '' });
});

test('past changes need no undo; one postponed into the future still shows', () => {
  const s = {
    exceptions: [
      { id: 'old', itemId: 'A', occursOn: '2026-10-01', kind: 'cancelled', newDate: null, newTime: null, note: null },
      { id: 'into', itemId: 'A', occursOn: '2026-10-04', kind: 'moved', newDate: '2026-10-06', newTime: null, note: null },
      { id: 'next', itemId: 'A', occursOn: '2026-10-08', kind: 'cancelled', newDate: null, newTime: null, note: null },
      { id: 'other', itemId: 'B', occursOn: '2026-10-08', kind: 'cancelled', newDate: null, newTime: null, note: null },
    ] as ScheduleException[],
  };
  expect(upcomingExceptions(s, 'A', '2026-10-05').map((e) => e.id)).toEqual(['into', 'next']);
});

test('admin list: visible first, then by weekday (Saturday first) and time', () => {
  const list = sortForAdmin([
    item({ id: 'hidden', days: [6], isActive: false }),
    item({ id: 'thu', days: [4], startTime: '21:30' }),
    item({ id: 'sat-late', days: [6], startTime: '21:00' }),
    item({ id: 'sat-early', days: [6], startTime: '07:00' }),
  ]);
  expect(list.map((i) => i.id)).toEqual(['sat-early', 'sat-late', 'thu', 'hidden']);
});
