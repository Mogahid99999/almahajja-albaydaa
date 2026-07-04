/**
 * Journey data access — رحلتي العلمية (Phase 2 · feature C).
 *
 * Weekly goal · مداومة/streak · milestone badges. Personal-only, never compared
 * between students. While `USE_MOCK` is true everything is served from
 * `src/mock/*`; the live Supabase path (tables + streak/week/summary RPCs in
 * supabase/migrations/0004) is wired at the §4 live cutover. Components never
 * import supabase directly (CLAUDE.md conventions); rollups are server-side SQL,
 * never client tree-walking.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import { BADGES } from '@/constants/badges';
import type { Badge, GoalMetric, JourneySummary, StreakStatus, WeeklyGoal } from './types';

export type {
  Badge,
  GoalMetric,
  JourneySummary,
  Streak,
  StreakStatus,
  WeeklyGoal,
  WeekProgress,
} from './types';

/** The signed-in user's id; personal tables all require it on write. */
async function requireUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  return user.id;
}

/** Page-header stats: totals, current+longest streak, this-week progress. */
export async function getJourneySummary(): Promise<JourneySummary> {
  if (USE_MOCK) return mock.getJourneySummary();
  const { data, error } = await supabase.rpc('get_journey_summary');
  if (error) throw error;
  const row = data?.[0];
  if (!row) {
    return {
      completedLectures: 0,
      totalSeconds: 0,
      streak: { current: 0, longest: 0 },
      activeDays: 0,
      week: { metric: 'lectures', target: 3, current: 0 },
    };
  }
  return {
    completedLectures: Number(row.completed_lectures ?? 0),
    totalSeconds: Number(row.total_seconds ?? 0),
    streak: { current: row.current_streak ?? 0, longest: row.longest_streak ?? 0 },
    activeDays: row.active_days ?? 0,
    week: {
      metric: row.week_metric ?? 'lectures',
      target: row.week_target ?? 3,
      current: row.week_current ?? 0,
    },
  };
}

/**
 * Home StreakCard state in one round-trip (feature 26.1): current streak,
 * whether today already counted, and whether the 3-day recovery window is open.
 */
export async function getStreakStatus(): Promise<StreakStatus> {
  if (USE_MOCK) {
    return { current: 0, todayCounted: false, recoveryAvailable: false, recoveryDaysLeft: 0 };
  }
  const { data, error } = await supabase.rpc('get_streak_status');
  if (error) throw error;
  const row = data?.[0];
  return {
    current: row?.current_streak ?? 0,
    todayCounted: row?.today_counted ?? false,
    recoveryAvailable: row?.recovery_available ?? false,
    recoveryDaysLeft: row?.recovery_days_left ?? 0,
  };
}

/** The student's active weekly goal (for the editor). */
export async function getWeeklyGoal(): Promise<WeeklyGoal> {
  if (USE_MOCK) return mock.getWeeklyGoal();
  const { data, error } = await supabase
    .from('weekly_goals')
    .select('metric, target')
    .maybeSingle();
  if (error) throw error;
  return data ?? { metric: 'lectures', target: 3 }; // matches table default
}

/** Set/replace the active weekly goal. */
export async function setWeeklyGoal(metric: GoalMetric, target: number): Promise<void> {
  if (USE_MOCK) return mock.setWeeklyGoal(metric, target);
  const userId = await requireUserId();
  const { error } = await supabase
    .from('weekly_goals')
    .upsert(
      { user_id: userId, metric, target, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}

/** Full badge catalog merged with this user's earned state (incl. locked). */
export async function getBadges(): Promise<Badge[]> {
  if (USE_MOCK) return mock.getBadges();
  const { data, error } = await supabase
    .from('user_badges')
    .select('badge_key, earned_at');
  if (error) throw error;
  const earned = new Map((data ?? []).map((b) => [b.badge_key, b.earned_at]));
  return BADGES.map((def) => ({
    key: def.key,
    titleAr: def.titleAr,
    descAr: def.descAr,
    threshold: def.threshold,
    kind: def.kind,
    earned: earned.has(def.key),
    earnedAt: earned.get(def.key) ?? null,
  }));
}

/**
 * Record a listening delta against today + re-evaluate badges; returns the
 * newly-earned badges. Called from the save-progress seam, not from the player
 * UI. Live: rpc('record_meaningful_activity') — accumulates the daily upsert
 * AND server-side decides when the day starts counting toward the streak
 * (≥120s accumulated or a completion; the 26.1 threshold + recovery live in
 * 0014's SQL, never per-tick JS — tick deltas are ~5s, capped at 90). Then
 * compare the badge catalog against get_journey_summary and insert-on-conflict
 * any new earns (badge rules stay in TS — PLAN_PHASE2.md §3.2).
 */
export async function recordListening(args: {
  lectureId: string | null;
  deltaSec: number;
  completed?: boolean;
}): Promise<Badge[]> {
  if (USE_MOCK) return mock.recordListening(args);

  const { error: recErr } = await supabase.rpc('record_meaningful_activity', {
    p_lecture_id: args.lectureId as string, // SQL fn accepts null; arg typed string
    p_seconds: args.deltaSec,
    p_completed: args.completed ?? false,
  });
  if (recErr) throw recErr;

  // Re-evaluate badges against the fresh server-side rollup.
  const summary = await getJourneySummary();
  const { completedLectures } = summary;
  const longest = summary.streak.longest;

  const { data: existing } = await supabase.from('user_badges').select('badge_key');
  const have = new Set((existing ?? []).map((b) => b.badge_key));

  const newly: Badge[] = [];
  const toInsert: { user_id: string; badge_key: string }[] = [];
  let userId: string | null = null;
  for (const def of BADGES) {
    if (have.has(def.key)) continue;
    const qualifies =
      def.kind === 'completed'
        ? completedLectures >= def.threshold
        : longest >= def.threshold;
    if (!qualifies) continue;
    userId ??= await requireUserId();
    toInsert.push({ user_id: userId, badge_key: def.key });
    newly.push({ ...def, earned: true, earnedAt: new Date().toISOString() });
  }
  if (toInsert.length) {
    await supabase
      .from('user_badges')
      .upsert(toInsert, { onConflict: 'user_id,badge_key', ignoreDuplicates: true });
  }
  return newly;
}
