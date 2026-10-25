/**
 * «الجدول الأسبوعي» admin (0158) — the pure parts of /admin/schedule: the item
 * form's draft ↔ ScheduleItemInput, the 24-hour time field, which dates of a
 * lesson can be changed alone, and how an existing change reads. Unit-tested.
 * The limits mirror the table checks in 0158 so the form says why before the
 * server refuses.
 */
import type { ScheduleAudience, ScheduleException, ScheduleItem, ScheduleItemInput } from '@/api/schedule';
import { addDays, arClockLine, arDate, dowOf, parseHM, WEEK_ORDER } from '@/lib/schedule';

export const ADMIN_SCHEDULE_COPY = {
  title: 'الجدول الأسبوعي',
  add: 'إضافة درس',
  empty: 'لا دروس في الجدول بعد. أضف الأول.',
  edit: 'تعديل',
  changeDay: 'تغيير يوم',
  hide: 'إخفاء',
  show: 'إظهار',
  remove: 'حذف',
  hidden: 'مخفي عن الطلاب',
  undo: 'تراجع',
  changes: 'تغييرات الأيام القادمة',
} as const;

const firstDay = (i: ScheduleItem) => Math.min(...i.days.map((d) => WEEK_ORDER.indexOf(d as (typeof WEEK_ORDER)[number])));

/** Visible first; then by the first weekday (Saturday first) and time. */
export function sortForAdmin(items: readonly ScheduleItem[]): ScheduleItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      firstDay(a) - firstDay(b) ||
      (parseHM(a.startTime) ?? 0) - (parseHM(b.startTime) ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

export const AUDIENCE_LABEL: Record<ScheduleAudience, string> = {
  all: 'الجميع',
  male: 'الإخوة',
  female: 'الأخوات',
};

export type ItemDraft = {
  id?: string;
  title: string;
  subtitle: string;
  subject: string;
  /** A sheikhs row; null = the free name below (or none). */
  sheikhId: string | null;
  sheikhName: string;
  sectionId: string | null;
  audience: ScheduleAudience;
  days: number[];
  /** As typed: '21:30', '9:05', '٢١:٣٠'. */
  time: string;
  /** Minutes, as typed; '' = not set. */
  duration: string;
  note: string;
  isActive: boolean;
};

export function draftFromItem(item?: ScheduleItem | null): ItemDraft {
  if (!item) {
    return {
      title: '',
      subtitle: '',
      subject: '',
      sheikhId: null,
      sheikhName: '',
      sectionId: null,
      audience: 'all',
      days: [],
      time: '',
      duration: '60',
      note: '',
      isActive: true,
    };
  }
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle ?? '',
    subject: item.subject ?? '',
    sheikhId: item.sheikhId,
    sheikhName: item.sheikhName ?? '',
    sectionId: item.sectionId,
    audience: item.audience,
    days: [...item.days],
    time: item.startTime,
    duration: item.durationMin ? String(item.durationMin) : '',
    note: item.note ?? '',
    isActive: item.isActive,
  };
}

const EASTERN = '٠١٢٣٤٥٦٧٨٩';
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(EASTERN.indexOf(d)));

/** A typed 24-hour time → 'HH:MM', or null. Accepts Arabic-Indic digits and «:» / «.» / «٫». */
export function normalizeHM(input: string): string | null {
  const m = /^(\d{1,2})\s*[:.٫]\s*(\d{2})$/.exec(latinDigits(input.trim()));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export type DraftCheck = { ok: true; input: ScheduleItemInput } | { ok: false; error: string };

export function validateItemDraft(d: ItemDraft): DraftCheck {
  const title = d.title.trim();
  if (title.length < 2) return { ok: false, error: 'اكتب عنوان الدرس.' };
  if (title.length > 150) return { ok: false, error: 'العنوان طويل — ١٥٠ حرفاً على الأكثر.' };
  if (d.subtitle.trim().length > 200) return { ok: false, error: 'الوصف طويل — ٢٠٠ حرف على الأكثر.' };
  if (d.subject.trim().length > 60) return { ok: false, error: 'اسم المادة طويل — ٦٠ حرفاً على الأكثر.' };
  if (!d.sheikhId && d.sheikhName.trim().length > 120) return { ok: false, error: 'اسم الشيخ طويل.' };
  const days = Array.from(new Set(d.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6)));
  if (days.length === 0) return { ok: false, error: 'اختر يوماً واحداً على الأقل.' };
  const time = normalizeHM(d.time);
  if (!time) return { ok: false, error: 'اكتب الوقت بنظام ٢٤ ساعة بتوقيت مكة، مثل 21:30.' };
  let durationMin: number | null = null;
  const rawDuration = latinDigits(d.duration.trim());
  if (rawDuration) {
    const n = Number(rawDuration);
    if (!Number.isInteger(n) || n < 5 || n > 600) {
      return { ok: false, error: 'المدة بالدقائق بين ٥ و٦٠٠، أو اتركها فارغة.' };
    }
    durationMin = n;
  }
  if (d.note.trim().length > 300) return { ok: false, error: 'الملاحظة طويلة — ٣٠٠ حرف على الأكثر.' };
  return {
    ok: true,
    input: {
      id: d.id,
      title,
      subtitle: d.subtitle.trim() || null,
      subject: d.subject.trim() || null,
      sheikhId: d.sheikhId,
      sheikhName: d.sheikhId ? null : d.sheikhName.trim() || null,
      sectionId: d.sectionId,
      audience: d.audience,
      days: days.sort((a, b) => a - b),
      startTime: time,
      durationMin,
      note: d.note.trim() || null,
      isActive: d.isActive,
    },
  };
}

/** The dates (from today, Mecca) on which this lesson is held — the ones a moderator may change alone. */
export function itemDates(item: Pick<ScheduleItem, 'days'>, today: string, span = 21): string[] {
  const out: string[] = [];
  for (let i = 0; i < span; i++) {
    const d = addDays(today, i);
    if (item.days.includes(dowOf(d))) out.push(d);
  }
  return out;
}

/** Dates a lesson can be postponed to: today … +span. */
export function targetDates(today: string, span = 21): string[] {
  return Array.from({ length: span }, (_, i) => addDays(today, i));
}

/** «الخميس ٩ أكتوبر — أُلغي» / «… — أُجّل إلى …» / «… — الوقت ٩:٠٠ مساءً». */
export function exceptionLine(e: ScheduleException, item: Pick<ScheduleItem, 'startTime'>): string {
  const head = arDate(e.occursOn);
  let what: string;
  if (e.kind === 'cancelled') {
    what = 'أُلغي';
  } else if (e.newDate && e.newDate !== e.occursOn) {
    what = `أُجّل إلى ${arDate(e.newDate)} ${arClockLine(e.newTime ?? item.startTime)}`;
  } else {
    what = `الوقت ${arClockLine(e.newTime ?? item.startTime)}`;
  }
  return `${head} — ${what}${e.note ? ` (${e.note})` : ''}`;
}

/** This item's single-date changes from `today` on (the past ones need no undo), by date. */
export function upcomingExceptions(s: { exceptions: ScheduleException[] }, itemId: string, today: string): ScheduleException[] {
  return s.exceptions
    .filter((e) => e.itemId === itemId && (e.occursOn >= today || (e.newDate ?? '') >= today))
    .sort((a, b) => a.occursOn.localeCompare(b.occursOn));
}

export type ChangeKind = 'cancel' | 'postpone' | 'time';

export type ChangeDraft = { kind: ChangeKind; newDate: string | null; time: string; note: string };

/** The date form, prefilled from that date's saved change (if any). */
export function changeDraft(item: Pick<ScheduleItem, 'startTime'>, existing?: ScheduleException | null): ChangeDraft {
  if (!existing) return { kind: 'cancel', newDate: null, time: item.startTime, note: '' };
  const away = !!existing.newDate && existing.newDate !== existing.occursOn;
  return {
    kind: existing.kind === 'cancelled' ? 'cancel' : away ? 'postpone' : 'time',
    newDate: away ? existing.newDate : null,
    time: existing.newTime ?? item.startTime,
    note: existing.note ?? '',
  };
}
