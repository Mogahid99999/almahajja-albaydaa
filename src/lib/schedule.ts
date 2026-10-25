/**
 * «الجدول الأسبوعي» (0158) — pure date logic, unit-tested. Everything the
 * screens show («اليوم»، «بعد ساعتين»، «أُجّل إلى…») is computed HERE, on the
 * device, from the one cached get_schedule payload — no polling, no extra reads.
 *
 * Time: lessons are stored in MECCA time (UTC+3, no daylight saving). A day is
 * a Mecca calendar date 'YYYY-MM-DD'; weekdays are Postgres/JS dow (0 Sunday …
 * 6 Saturday); the week is shown Saturday first.
 *
 * A date of a lesson can be changed alone (schedule_exceptions):
 *  - cancelled  → still listed that day, crossed out, with the note;
 *  - moved to another date → listed on its original day as «أُجّل إلى …» and
 *    held on the new date («مؤجَّل من …»);
 *  - moved to another time the same day → held at the new time («تغيّر الموعد»).
 */
import type { Schedule, ScheduleException, ScheduleItem } from '@/api/schedule';
import { toArabicDigits } from '@/lib/format';

export const MECCA_OFFSET_MIN = 180;
const DAY_MS = 86_400_000;

/** Indexed by dow (0 Sunday … 6 Saturday). */
export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;
/** «كل جمعة» / «يومياً عدا جمعة…» forms (no «ال»). */
const DAY_BARE = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;
export const DAY_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;
/** Saturday first. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// ─── Dates (Mecca) ────────────────────────────────────────────────────────────

export function meccaToday(nowMs: number): { date: string; dow: number; minutes: number } {
  const d = new Date(nowMs + MECCA_OFFSET_MIN * 60_000);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function dateUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: string, n: number): string {
  return new Date(dateUtcMs(date) + n * DAY_MS).toISOString().slice(0, 10);
}

export function dowOf(date: string): number {
  return new Date(dateUtcMs(date)).getUTCDay();
}

/** 'HH:MM' → minutes after midnight; null when malformed. */
export function parseHM(hm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** The instant a lesson starts (epoch ms) — the date + time are Mecca's. */
export function startMs(date: string, hm: string): number {
  return dateUtcMs(date) + (parseHM(hm) ?? 0) * 60_000 - MECCA_OFFSET_MIN * 60_000;
}

// ─── Occurrences ──────────────────────────────────────────────────────────────

export type OccurrenceStatus = 'normal' | 'cancelled' | 'moved_away' | 'moved_in' | 'time_changed';

export type Occurrence = {
  key: string;
  item: ScheduleItem;
  date: string;
  /** When it is held (or would have been, for cancelled / moved_away). Mecca 'HH:MM'. */
  time: string;
  status: OccurrenceStatus;
  note: string | null;
  /** moved_away: where it went. */
  movedTo?: { date: string; time: string };
  /** moved_in / time_changed: where it came from. */
  movedFrom?: { date: string; time: string };
};

export function isHeld(o: Occurrence): boolean {
  return o.status === 'normal' || o.status === 'moved_in' || o.status === 'time_changed';
}

const exKey = (itemId: string, date: string) => `${itemId}|${date}`;

/** Every lesson of one Mecca date, the single-date changes applied, by time. */
export function occurrencesOn(s: Schedule, date: string, opts: { includePaused?: boolean } = {}): Occurrence[] {
  const items = s.items.filter((i) => i.isActive || opts.includePaused);
  const byId = new Map(items.map((i) => [i.id, i]));
  const exceptions = new Map<string, ScheduleException>();
  for (const e of s.exceptions) exceptions.set(exKey(e.itemId, e.occursOn), e);
  const dow = dowOf(date);
  const out: Occurrence[] = [];

  for (const item of items) {
    if (!item.days.includes(dow)) continue;
    const ex = exceptions.get(exKey(item.id, date));
    const base = { key: `${item.id}|${date}`, item, date };
    if (!ex) {
      out.push({ ...base, time: item.startTime, status: 'normal', note: null });
    } else if (ex.kind === 'cancelled') {
      out.push({ ...base, time: item.startTime, status: 'cancelled', note: ex.note });
    } else {
      const toDate = ex.newDate ?? date;
      const toTime = ex.newTime ?? item.startTime;
      if (toDate === date) {
        out.push({
          ...base,
          time: toTime,
          status: 'time_changed',
          note: ex.note,
          movedFrom: { date, time: item.startTime },
        });
      } else {
        out.push({
          ...base,
          time: item.startTime,
          status: 'moved_away',
          note: ex.note,
          movedTo: { date: toDate, time: toTime },
        });
      }
    }
  }

  // Lessons postponed INTO this date from another one.
  for (const e of s.exceptions) {
    if (e.kind !== 'moved' || e.newDate !== date || e.occursOn === date) continue;
    const item = byId.get(e.itemId);
    if (!item) continue;
    out.push({
      key: `${item.id}|${e.occursOn}>${date}`,
      item,
      date,
      time: e.newTime ?? item.startTime,
      status: 'moved_in',
      note: e.note,
      movedFrom: { date: e.occursOn, time: item.startTime },
    });
  }

  return out.sort(
    (a, b) =>
      (parseHM(a.time) ?? 0) - (parseHM(b.time) ?? 0) ||
      a.item.sortOrder - b.item.sortOrder ||
      a.item.title.localeCompare(b.item.title),
  );
}

/** Held lessons from now on (the one in progress included), over `days` days. */
export function upcoming(s: Schedule, nowMs: number, days = 14): Occurrence[] {
  const today = meccaToday(nowMs).date;
  const out: Occurrence[] = [];
  for (let i = 0; i < days; i++) {
    for (const o of occurrencesOn(s, addDays(today, i))) {
      if (!isHeld(o)) continue;
      const end = startMs(o.date, o.time) + (o.item.durationMin ?? 60) * 60_000;
      if (end > nowMs) out.push(o);
    }
  }
  return out;
}

export function nextOccurrence(s: Schedule, nowMs: number): Occurrence | null {
  return upcoming(s, nowMs, 14)[0] ?? null;
}

// ─── Arabic labels ────────────────────────────────────────────────────────────

/** '21:30' → { time: '٩:٣٠', period: 'مساءً' }. */
export function arClock(hm: string): { time: string; period: string } {
  const minutes = parseHM(hm) ?? 0;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h < 4 ? 'ليلاً' : h < 12 ? 'صباحاً' : h < 15 ? 'ظهراً' : h < 18 ? 'عصراً' : 'مساءً';
  const h12 = h % 12 || 12;
  return { time: toArabicDigits(`${h12}:${String(m).padStart(2, '0')}`), period };
}

export function arClockLine(hm: string): string {
  const c = arClock(hm);
  return `${c.time} ${c.period}`;
}

/** 'الخميس ٩ أكتوبر'. */
export function arDate(date: string): string {
  const d = new Date(dateUtcMs(date));
  return `${DAY_NAMES[d.getUTCDay()]} ${toArabicDigits(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

/** «اليوم» / «غداً» / «الخميس ٩ أكتوبر». */
export function arDayTitle(date: string, today: string): string {
  if (date === today) return 'اليوم';
  if (date === addDays(today, 1)) return 'غداً';
  return arDate(date);
}

/** «يومياً» · «يومياً عدا الجمعة» · «كل جمعة» · «الأحد · الخميس» (Saturday first). */
export function arDaysLabel(days: readonly number[]): string {
  const set = new Set(days.filter((d) => d >= 0 && d <= 6));
  if (set.size === 7) return 'يومياً';
  if (set.size === 6) {
    const missing = WEEK_ORDER.find((d) => !set.has(d));
    return `يومياً عدا ${DAY_NAMES[missing ?? 5]}`;
  }
  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  if (ordered.length === 1) return `كل ${DAY_BARE[ordered[0]]}`;
  return ordered.map((d) => DAY_NAMES[d]).join(' · ');
}

function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${toArabicDigits(n)} ${few}`;
  return `${toArabicDigits(n)} ${many}`;
}

/** «الآن» while it runs; «بعد ٢٠ دقيقة» / «بعد ساعتين» within 12 h; else null. */
export function arRelative(start: number, durationMin: number | null, nowMs: number): string | null {
  const end = start + (durationMin ?? 60) * 60_000;
  if (nowMs >= start && nowMs < end) return 'الآن';
  const mins = Math.round((start - nowMs) / 60_000);
  if (mins < 0) return null;
  if (mins < 60) return `بعد ${arCount(Math.max(mins, 1), 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const hours = Math.round(mins / 60);
  if (hours > 12) return null;
  return `بعد ${arCount(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
}

/** What a changed date says under its title. */
export function arStatusLine(o: Occurrence): string | null {
  switch (o.status) {
    case 'cancelled':
      return o.note ? `لا درس في هذا الموعد — ${o.note}` : 'لا درس في هذا الموعد';
    case 'moved_away':
      return `أُجّل إلى ${arDate(o.movedTo!.date)} ${arClockLine(o.movedTo!.time)}${o.note ? ` — ${o.note}` : ''}`;
    case 'moved_in':
      return `مؤجَّل من ${arDate(o.movedFrom!.date)}${o.note ? ` — ${o.note}` : ''}`;
    case 'time_changed':
      return `تغيّر الموعد هذه المرة (كان ${arClockLine(o.movedFrom!.time)})${o.note ? ` — ${o.note}` : ''}`;
    default:
      return null;
  }
}

/**
 * «بتوقيتك: …» for someone outside Mecca's time zone (device offset in minutes
 * east of UTC, i.e. -getTimezoneOffset()); null inside it.
 */
export function arLocalLine(date: string, hm: string, deviceOffsetMin: number): string | null {
  if (deviceOffsetMin === MECCA_OFFSET_MIN) return null;
  const local = new Date(startMs(date, hm) + deviceOffsetMin * 60_000);
  const localDate = local.toISOString().slice(0, 10);
  const line = arClockLine(`${local.getUTCHours()}:${String(local.getUTCMinutes()).padStart(2, '0')}`);
  const shift = localDate > date ? ' (اليوم التالي)' : localDate < date ? ' (اليوم السابق)' : '';
  return `بتوقيتك: ${line}${shift}`;
}

export function deviceOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

// ─── «حسب الشيخ» ──────────────────────────────────────────────────────────────

export type SheikhLesson = {
  title: string;
  /** Every item of this title (one per time of day). */
  items: ScheduleItem[];
  /** «الأحد · الخميس» for one time; «الثلاثاء ٩:٣٠ مساءً · الجمعة ٥:٠٠ عصراً» for several. */
  when: string;
  /** The single time ('HH:MM') when there is only one, else null. */
  time: string | null;
  /** «موعدان» / «٣ مواعيد» when the lesson has several times, else null. */
  countLabel: string | null;
};

export type SheikhGroup = { sheikh: string; lessons: SheikhLesson[] };

/** First weekday of an item in the Saturday-first week (for ordering). */
const weekPos = (i: ScheduleItem) => Math.min(...i.days.map((d) => WEEK_ORDER.indexOf(d as (typeof WEEK_ORDER)[number])));

/**
 * The active items, by sheikh; one lesson title with several times of day (two
 * items) is merged into one row — «الأربعون النووية · موعدان».
 */
export function groupBySheikh(items: readonly ScheduleItem[], otherLabel = 'دروس أخرى'): SheikhGroup[] {
  const groups = new Map<string, Map<string, ScheduleItem[]>>();
  const ordered = items
    .filter((i) => i.isActive)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        weekPos(a) - weekPos(b) ||
        (parseHM(a.startTime) ?? 0) - (parseHM(b.startTime) ?? 0),
    );
  for (const item of ordered) {
    const sheikh = item.sheikhName?.trim() || otherLabel;
    const lessons = groups.get(sheikh) ?? new Map<string, ScheduleItem[]>();
    const list = lessons.get(item.title) ?? [];
    list.push(item);
    lessons.set(item.title, list);
    groups.set(sheikh, lessons);
  }
  const out: SheikhGroup[] = [];
  for (const [sheikh, lessons] of groups) {
    out.push({
      sheikh,
      lessons: [...lessons].map(([title, list]) => {
        if (list.length === 1) {
          return { title, items: list, when: arDaysLabel(list[0].days), time: list[0].startTime, countLabel: null };
        }
        return {
          title,
          items: list,
          when: list.map((i) => `${arDaysLabel(i.days)} ${arClockLine(i.startTime)}`).join(' · '),
          time: null,
          countLabel: list.length === 2 ? 'موعدان' : `${toArabicDigits(list.length)} مواعيد`,
        };
      }),
    });
  }
  // «دروس أخرى» (no sheikh named) last.
  return out.sort((a, b) => Number(a.sheikh === otherLabel) - Number(b.sheikh === otherLabel));
}
