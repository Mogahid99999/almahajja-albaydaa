import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getBadges, getJourneySummary, getWeeklyGoal, setWeeklyGoal } from '@/api/journey';
import type { GoalMetric } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';

/** Page-header stats: totals, streak (مداومة), this-week goal progress. */
export function useJourneySummary() {
  return useQuery({
    queryKey: queryKeys.journey,
    queryFn: getJourneySummary,
  });
}

/** The active weekly goal (for the editor sheet). */
export function useWeeklyGoal() {
  return useQuery({
    queryKey: queryKeys.weeklyGoal,
    queryFn: getWeeklyGoal,
  });
}

/** Full badge catalog merged with earned state (earned + locked seals). */
export function useBadges() {
  return useQuery({
    queryKey: queryKeys.badges,
    queryFn: getBadges,
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
