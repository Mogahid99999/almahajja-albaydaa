/**
 * Shared Arabic labels + goal presets for the رحلتي العلمية UI (feature C).
 * Kept in one place so the card, editor, and Home card phrase goals identically.
 */
import type { GoalMetric } from '@/api/types';
import type { BuddyGoalMetric } from '@/api/buddyGoals';
import { arNum } from '@/lib/format';

/** Noun for a goal metric (simplified Arabic plural — calm, not grammar-perfect). */
export const metricNoun = (metric: GoalMetric): string =>
  metric === 'minutes' ? 'دقيقة' : 'دروس';

/** "٢ من ٣ دروس" */
export const formatGoalProgress = (
  current: number,
  target: number,
  metric: GoalMetric,
): string => `${arNum(current)} من ${arNum(target)} ${metricNoun(metric)}`;

/** Metric options for the editor toggle. */
export const metricChoices: { metric: GoalMetric; label: string }[] = [
  { metric: 'lectures', label: 'دروس' },
  { metric: 'minutes', label: 'دقائق' },
];

/** Target presets offered per metric. */
export const targetPresets: Record<GoalMetric, number[]> = {
  lectures: [3, 5, 7, 10],
  minutes: [30, 60, 90, 120],
};

/** Fallback target when switching metric to one whose presets exclude the old value. */
export const defaultTarget: Record<GoalMetric, number> = {
  lectures: 3,
  minutes: 60,
};

// --- Upgraded weekly goal stats (V20 · §5) -----------------------------------

/** Derived weekly-goal figures for the card (all client-side, no schema). */
export type WeekGoalStats = {
  /** 0..∞ ratio (can exceed 1 — the goal doesn't stop at 100%). */
  ratio: number;
  /** Whole-percent progress (can exceed 100). */
  percent: number;
  /** Whether the target was reached (or passed). */
  reached: boolean;
  /** Whether progress passed the target (strictly over). */
  overTarget: boolean;
  /** Days left in the current Sat→Fri week INCLUDING today (1..7). */
  daysLeft: number;
  /** Remaining units to hit target (0 when reached). */
  remaining: number;
  /** Units/day needed to still finish on time (⌈remaining ÷ daysLeft⌉); 0 when reached. */
  dailyNeeded: number;
};

/**
 * Days left in the current Sat→Fri week, counting today (so Saturday = 7, Friday
 * = 1). Uses the device-local weekday to match the local-day streak/week math
 * (F-043). `getDay()`: Sun=0..Sat=6; the Sat→Fri week makes Saturday index 0.
 */
export function daysLeftInWeek(now: Date = new Date()): number {
  const idxFromSat = (now.getDay() + 1) % 7; // Sat=0, Sun=1, …, Fri=6
  return 7 - idxFromSat;
}

/**
 * Compute the §5 weekly-goal figures from raw progress. Pure + timezone-aware via
 * `now` (injectable for tests). `dailyNeeded` rounds UP so a partial day still
 * asks for the whole remaining lesson; both remaining/dailyNeeded are 0 once the
 * target is reached (the card then shows the over-target line instead).
 */
export function weekGoalStats(
  current: number,
  target: number,
  now: Date = new Date(),
): WeekGoalStats {
  const safeTarget = Math.max(0, target);
  const ratio = safeTarget > 0 ? current / safeTarget : 0;
  const percent = Math.round(ratio * 100);
  const reached = safeTarget > 0 && current >= safeTarget;
  const overTarget = safeTarget > 0 && current > safeTarget;
  const daysLeft = daysLeftInWeek(now);
  const remaining = reached ? 0 : Math.max(0, safeTarget - current);
  const dailyNeeded = remaining > 0 && daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0;
  return { ratio, percent, reached, overTarget, daysLeft, remaining, dailyNeeded };
}

/** "بقي ٤ أيام" / "بقي يوم واحد" — days-left phrasing. */
export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft <= 1) return 'آخر يوم في الأسبوع';
  if (daysLeft === 2) return 'بقي يومان';
  return `بقي ${arNum(daysLeft)} أيام`;
}

/** "تحتاج إلى درس واحد يومياً" / "تحتاج إلى ٣ دروس يومياً" — required daily rate. */
export function formatDailyNeeded(dailyNeeded: number, metric: GoalMetric): string {
  const noun = metric === 'minutes' ? 'دقيقة' : dailyNeeded === 1 ? 'درس' : 'دروس';
  const unit = dailyNeeded === 1 ? `${noun} واحد` : `${arNum(dailyNeeded)} ${noun}`;
  return `تحتاج إلى ${unit} يومياً`;
}

// --- Buddy shared goals (V20 · §10) ------------------------------------------

/** Unit noun for a buddy-goal metric. */
export function buddyMetricNoun(metric: BuddyGoalMetric, n: number): string {
  if (metric === 'minutes') return 'دقيقة';
  if (metric === 'active_days') return n === 1 ? 'يوم نشاط' : 'أيام نشاط';
  return n === 1 ? 'درس' : 'دروس';
}

/** "٥ دروس لكل طالب" — the goal target phrasing. */
export function formatBuddyGoalTarget(target: number, metric: BuddyGoalMetric): string {
  return `${arNum(target)} ${buddyMetricNoun(metric, target)} لكل طالب`;
}

/** "أنت ٤ من ٥ — رفيقك ٣ من ٥" — both sides' progress. */
export function formatBuddySides(
  mine: number,
  theirs: number,
  target: number,
): string {
  return `أنت ${arNum(mine)} من ${arNum(target)} — رفيقك ${arNum(theirs)} من ${arNum(target)}`;
}

/** Metric choices for the goal creator. */
export const buddyMetricChoices: { metric: BuddyGoalMetric; label: string }[] = [
  { metric: 'lectures', label: 'دروس' },
  { metric: 'minutes', label: 'دقائق' },
  { metric: 'active_days', label: 'أيام نشاط' },
];
