import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { evaluateBadges, getBadges, getJourneySummary, getWeeklyGoal, setWeeklyGoal } from '@/api/journey';
import type { GoalMetric, JourneySummary, WeeklyGoal } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';
import { enqueueGoal } from '@/lib/outbox';

/**
 * Page-header stats: totals, streak (مداومة), this-week goal progress.
 * `enabled` is off for guests — the journey is gated behind registration (Task 3),
 * so we don't fetch a guest's progress just to hide it. `keepPreviousData` holds
 * the last snapshot on screen offline (V11 · E) instead of blanking to a spinner.
 */
export function useJourneySummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.journey,
    queryFn: getJourneySummary,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/** The active weekly goal (for the editor sheet). */
export function useWeeklyGoal(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.weeklyGoal,
    queryFn: getWeeklyGoal,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/** Full badge catalog merged with earned state (earned + locked seals). */
export function useBadges(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.badges,
    queryFn: getBadges,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/**
 * Set/replace the weekly goal; optimistic (offline-first) + queued on failure.
 * The value is reflected immediately (and persisted), the editor sheet closes
 * normally whether online or off, and an offline edit replays on reconnect.
 */
export function useSetWeeklyGoal() {
  const qc = useQueryClient();
  return useMutation({
    // offlineFirst so an offline edit fails fast → onError queues it in the outbox
    // (the default 'online' would PAUSE the mutation, losing it across a force-stop).
    networkMode: 'offlineFirst',
    mutationFn: (vars: { metric: GoalMetric; target: number }) =>
      setWeeklyGoal(vars.metric, vars.target),
    onMutate: (vars) => {
      qc.setQueryData(
        queryKeys.weeklyGoal,
        (): WeeklyGoal => ({ metric: vars.metric, target: vars.target }),
      );
      // The GoalCard renders summary.week (not the weeklyGoal query), so patch the
      // journey summary too — the new target shows instantly, even offline.
      qc.setQueryData<JourneySummary>(queryKeys.journey, (old) =>
        old
          ? { ...old, week: { ...old.week, metric: vars.metric, target: vars.target } }
          : old,
      );
    },
    onError: (_e, vars) => {
      void enqueueGoal(vars.metric, vars.target);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.weeklyGoal });
      qc.invalidateQueries({ queryKey: queryKeys.journey });
    },
  });
}

/**
 * Re-evaluate milestone badges once when رحلتي العلمية mounts (V11 · C — badges
 * are otherwise only evaluated on a completion event). Catches up any badge
 * earned while offline or via the server-side streak crons. Best-effort + silent.
 */
export function useSyncBadgesOnMount(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void evaluateBadges()
      .then((newly) => {
        if (!cancelled && newly.length > 0) {
          qc.invalidateQueries({ queryKey: queryKeys.badges });
        }
      })
      .catch(() => {
        /* offline / transient — the badges query still renders from cache */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, qc]);
}
