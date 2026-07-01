import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getBadges, getJourneySummary, getWeeklyGoal, setWeeklyGoal } from '@/api/journey';
import type { GoalMetric } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';

/**
 * Page-header stats: totals, streak (مداومة), this-week goal progress.
 * `enabled` is off for guests — the journey is gated behind registration (Task 3),
 * so we don't fetch a guest's progress just to hide it.
 */
export function useJourneySummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.journey,
    queryFn: getJourneySummary,
    enabled: options?.enabled ?? true,
  });
}

/** The active weekly goal (for the editor sheet). */
export function useWeeklyGoal(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.weeklyGoal,
    queryFn: getWeeklyGoal,
    enabled: options?.enabled ?? true,
  });
}

/** Full badge catalog merged with earned state (earned + locked seals). */
export function useBadges(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.badges,
    queryFn: getBadges,
    enabled: options?.enabled ?? true,
  });
}

/** Set/replace the weekly goal; refreshes the goal + summary (week bar). */
export function useSetWeeklyGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { metric: GoalMetric; target: number }) =>
      setWeeklyGoal(vars.metric, vars.target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.weeklyGoal });
      qc.invalidateQueries({ queryKey: queryKeys.journey });
    },
  });
}
