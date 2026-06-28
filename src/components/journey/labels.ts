/**
 * Shared Arabic labels + goal presets for the رحلتي العلمية UI (feature C).
 * Kept in one place so the card, editor, and Home card phrase goals identically.
 */
import type { GoalMetric } from '@/api/types';
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
