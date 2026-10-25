/**
 * «ذكّرني قبل الدرس» (0158) — local notifications 15–20 minutes before each held
 * date of the lessons the student chose, over the next 10 days, re-planned
 * whenever the schedule (or the choice) changes. A cancelled or postponed date
 * follows automatically: planning works on occurrences, the changes applied.
 *
 * Pure planning (planScheduleReminders) is unit-tested; syncScheduleReminders
 * replaces whatever was planned before (identifiers 'sched:…').
 *
 * LOAD V25: the extra 0–5 min is this install's fixed jitter
 * (scheduleRemindersStore.jitterMs) — phones are not woken in the same second.
 */
import type { Schedule } from '@/api/schedule';
import { cancelLocalByPrefix, scheduleLocalAt } from '@/lib/notifications';
import { arClockLine, startMs, upcoming } from '@/lib/schedule';
import { REMINDER_SPREAD_MS } from '@/stores/scheduleRemindersStore';

export const REMINDER_PREFIX = 'sched:';
export const REMINDER_LEAD_MS = 15 * 60_000;
export const REMINDER_DAYS = 10;
/** iOS keeps at most 64 pending local notifications for the whole app. */
export const REMINDER_MAX = 20;

export type PlannedReminder = {
  id: string;
  atMs: number;
  title: string;
  body: string;
};

export function planScheduleReminders(
  s: Schedule,
  ids: readonly string[],
  nowMs: number,
  jitterMs = 0,
): PlannedReminder[] {
  if (!ids.length) return [];
  const lead = REMINDER_LEAD_MS + Math.min(Math.max(0, Math.round(jitterMs)), REMINDER_SPREAD_MS);
  const wanted = new Set(ids);
  const out: PlannedReminder[] = [];
  for (const o of upcoming(s, nowMs, REMINDER_DAYS)) {
    if (!wanted.has(o.item.id)) continue;
    const atMs = startMs(o.date, o.time) - lead;
    if (atMs <= nowMs + 30_000) continue; // too late to remind about this one
    out.push({
      id: `${REMINDER_PREFIX}${o.item.id}:${o.date}`,
      atMs,
      title: `بعد نحو ربع ساعة: ${o.item.title}`,
      body: [o.item.sheikhName, `${arClockLine(o.time)} بتوقيت مكة`].filter(Boolean).join(' · '),
    });
    if (out.length >= REMINDER_MAX) break;
  }
  return out;
}

let running: Promise<void> | null = null;

/** Replace the planned lesson reminders. Never throws. */
export function syncScheduleReminders(
  s: Schedule,
  ids: readonly string[],
  jitterMs = 0,
  nowMs = Date.now(),
): Promise<void> {
  const plan = planScheduleReminders(s, ids, nowMs, jitterMs);
  const job = async () => {
    await cancelLocalByPrefix(REMINDER_PREFIX);
    for (const r of plan) {
      await scheduleLocalAt(r.id, r.atMs, {
        title: r.title,
        body: r.body,
        data: { route: '/(student)/schedule' },
      });
    }
  };
  // Serialize: two quick changes must not interleave cancel/schedule.
  running = (running ?? Promise.resolve()).then(job, job).catch(() => undefined);
  return running;
}
