/**
 * «متى يبدأ المجلس؟» — PURE helpers for scheduling a live from CreateLiveSheet
 * (owner 2026-09-29: «الجدولة للبث لم اجدها»). No native date picker: day chips
 * («اليوم» / «غداً» / weekday + date) and a 12-hour time in 15-minute steps
 * with ص/م, all in Arabic digits. Local device time; the RPC gets an ISO
 * timestamp (UTC), so the server and every viewer agree on the instant.
 */
import { arNum } from '@/lib/format';
import { arClock } from './liveUi';

/** At least this far ahead (the server itself only refuses the past). */
export const SCHEDULE_MIN_LEAD_MS = 10 * 60_000;
/** At most this far ahead. */
export const SCHEDULE_MAX_AHEAD_MS = 30 * 86_400_000;
/** Minute steps of the time chooser. */
export const SCHEDULE_MINUTES = [0, 15, 30, 45] as const;
/** Day chips offered: today + the next 29 days (≤ 30 days ahead). */
export const SCHEDULE_DAY_COUNT = 30;

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export type SchedulePeriod = 'am' | 'pm';

/** The chooser's state: a day offset from today + a 12-hour clock. */
export interface ScheduleChoice {
  /** 0 = today, 1 = tomorrow, … */
  dayOffset: number;
  /** 1..12 */
  hour12: number;
  /** 0 | 15 | 30 | 45 */
  minute: number;
  period: SchedulePeriod;
}

export interface ScheduleDay {
  offset: number;
  /** «اليوم» / «غداً» / weekday. */
  label: string;
  /** «٢ أكتوبر». */
  date: string;
}

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** «٢ أكتوبر». */
export function arDayMonth(d: Date): string {
  return `${arNum(d.getDate())} ${MONTHS[d.getMonth()]}`;
}

/** The day chips, today first. */
export function scheduleDays(nowMs: number, count = SCHEDULE_DAY_COUNT): ScheduleDay[] {
  const base = startOfDay(nowMs);
  const out: ScheduleDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    out.push({
      offset: i,
      label: i === 0 ? 'اليوم' : i === 1 ? 'غداً' : WEEKDAYS[d.getDay()],
      date: arDayMonth(d),
    });
  }
  return out;
}

/** 12-hour + ص/م → hour of day 0..23. */
export function to24h(hour12: number, period: SchedulePeriod): number {
  const h = hour12 % 12;
  return period === 'pm' ? h + 12 : h;
}

/** The instant a choice stands for (local time). */
export function scheduleDate(choice: ScheduleChoice, nowMs: number): Date {
  const base = startOfDay(nowMs);
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + choice.dayOffset,
    to24h(choice.hour12, choice.period),
    choice.minute,
  );
}

/**
 * The default when «في موعد لاحق» is picked: about an hour from now, on the
 * next quarter hour (tomorrow if that crosses midnight).
 */
export function defaultScheduleChoice(nowMs: number): ScheduleChoice {
  const step = 15 * 60_000;
  const t = new Date(Math.ceil((nowMs + 60 * 60_000) / step) * step);
  const dayOffset = Math.round((startOfDay(t.getTime()).getTime() - startOfDay(nowMs).getTime()) / 86_400_000);
  const h24 = t.getHours();
  return {
    dayOffset,
    hour12: h24 % 12 === 0 ? 12 : h24 % 12,
    minute: t.getMinutes() - (t.getMinutes() % 15),
    period: h24 < 12 ? 'am' : 'pm',
  };
}

export type ScheduleProblem = 'too_soon' | 'too_far';

/** Null when `atMs` is 10 minutes … 30 days ahead of `nowMs`. */
export function scheduleProblem(atMs: number, nowMs: number): ScheduleProblem | null {
  if (!Number.isFinite(atMs) || atMs < nowMs + SCHEDULE_MIN_LEAD_MS) return 'too_soon';
  if (atMs > nowMs + SCHEDULE_MAX_AHEAD_MS) return 'too_far';
  return null;
}

export const SCHEDULE_COPY = {
  question: 'متى يبدأ المجلس؟',
  now: 'الآن',
  later: 'في موعد لاحق',
  day: 'يوم المجلس',
  hour: 'الساعة',
  minute: 'الدقيقة',
  submit: 'جدولة المجلس',
  tooSoon: 'اختر موعداً بعد عشر دقائق من الآن على الأقل',
  tooFar: 'أبعد موعد ممكن بعد ثلاثين يوماً',
  sub: 'يظهر للطلاب في «المجالس القادمة» ويصلهم تذكير قبل بدئه. تفتح غرفة التجهيز من «البث المباشر» قبل الموعد.',
} as const;

export function scheduleProblemText(p: ScheduleProblem): string {
  return p === 'too_soon' ? SCHEDULE_COPY.tooSoon : SCHEDULE_COPY.tooFar;
}

/** «اليوم» / «غداً» / «الخميس ٢ أكتوبر» for a scheduled instant. */
export function scheduleDayLabel(iso: string, nowMs: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.round((startOfDay(d.getTime()).getTime() - startOfDay(nowMs).getTime()) / 86_400_000);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'غداً';
  return `${WEEKDAYS[d.getDay()]} ${arDayMonth(d)}`;
}

/** «الخميس ٢ أكتوبر · ٨:٣٠ م» — the chooser's summary line. */
export function scheduleSummary(iso: string, nowMs: number): string {
  return `${scheduleDayLabel(iso, nowMs)} · ${arClock(iso)}`;
}

/** «جُدول المجلس: غداً ٨:٣٠ م، ويصل الطلاب تذكير قبل بدئه». */
export function scheduledConfirmLine(iso: string, nowMs: number): string {
  return `جُدول المجلس: ${scheduleDayLabel(iso, nowMs)} ${arClock(iso)}، ويصل الطلاب تذكير قبل بدئه`;
}
