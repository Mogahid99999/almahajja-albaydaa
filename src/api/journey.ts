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
import { localDay } from '@/lib/outboxQueue';
import * as mock from '@/mock/api';
import { BADGES } from '@/constants/badges';
import type {
  Badge,
  BadgeMetric,
  BadgeMetrics,
  GoalMetric,
  JourneySummary,
  StreakStatus,
  WeeklyGoal,
} from './types';

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

/**
 * Call a day-anchored RPC with the DEVICE-LOCAL day (audit F-043 / migration
 * 0090): «واصلت اليوم», the streak anchor and the Sat→Fri week bounds must flip
 * at the user's midnight, not the server's UTC midnight (2–4h earlier for the
 * target audience). Falls back to the zero-arg pre-0090 signature when the
 * migration isn't applied yet (PGRST202 = function not found) and remembers
 * that outcome for the rest of the session (one wasted probe, not two round
 * trips per read), so either order of {migration applied, app updated} keeps
 * working. The `as never` casts exist because database.generated.ts still
 * describes the pre-0090 signatures — post-0090 cleanup (F-049): regenerate
 * the types, then delete this helper in favor of direct typed calls.
 */
let pTodaySupported: boolean | null = null;

export async function rpcWithLocalToday<T>(
  fn: 'get_journey_summary' | 'get_streak_status' | 'try_claim_goal_congrats',
): Promise<T> {
  if (pTodaySupported !== false) {
    const withDay = await supabase.rpc(fn, { p_today: localDay() } as never);
    if (!withDay.error) {
      pTodaySupported = true;
      return withDay.data as T;
    }
    if (withDay.error.code !== 'PGRST202') throw withDay.error;
    pTodaySupported = false;
  }
  const { data, error } = await supabase.rpc(fn);
  if (error) throw error;
  return data as T;
}

/** Page-header stats: totals, current+longest streak, this-week progress. */
export async function getJourneySummary(): Promise<JourneySummary> {
  if (USE_MOCK) return mock.getJourneySummary();
  type SummaryRow = {
    completed_lectures: number | null;
    total_seconds: number | null;
    current_streak: number | null;
    longest_streak: number | null;
    active_days: number | null;
    week_metric: GoalMetric | null;
    week_target: number | null;
    week_current: number | null;
  };
  const data = await rpcWithLocalToday<SummaryRow[] | null>('get_journey_summary');
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
  type StatusRow = {
    current_streak: number | null;
    today_counted: boolean | null;
    recovery_available: boolean | null;
    recovery_days_left: number | null;
  };
  const data = await rpcWithLocalToday<StatusRow[] | null>('get_streak_status');
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

/** One touched series on «خريطة رحلتي» (§6). */
export type JourneyMapEntry = {
  sectionId: string;
  sectionTitle: string;
  parentTitle: string | null;
  total: number;
  completed: number;
  nextLectureId: string | null;
  nextLectureTitle: string | null;
};

/** The series the student has touched, most-recently-active first (§6). */
export async function getJourneyMap(): Promise<JourneyMapEntry[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_journey_map');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    sectionId: r.section_id,
    sectionTitle: r.section_title ?? 'سلسلة',
    parentTitle: r.parent_title ?? null,
    total: Number(r.total_lectures ?? 0),
    completed: Number(r.completed_lectures ?? 0),
    nextLectureId: r.next_lecture_id ?? null,
    nextLectureTitle: r.next_lecture_title ?? null,
  }));
}

/** The extra per-user badge metrics (get_badge_metrics, 0106). */
export async function getBadgeMetrics(): Promise<BadgeMetrics> {
  if (USE_MOCK) {
    return {
      completedSeries: 0,
      quizzesPassed: 0,
      hasMastery: false,
      benefitsCount: 0,
      benefitDays: 0,
    };
  }
  const { data, error } = await supabase.rpc('get_badge_metrics');
  if (error) throw error;
  const row = data?.[0];
  return {
    completedSeries: Number(row?.completed_series ?? 0),
    quizzesPassed: Number(row?.quizzes_passed ?? 0),
    hasMastery: !!row?.has_mastery,
    benefitsCount: Number(row?.benefits_count ?? 0),
    benefitDays: Number(row?.benefit_days ?? 0),
  };
}

/**
 * The user's current value for a given badge metric, from the two rollups. This
 * is the single source of truth used by BOTH getBadges (locked progress hint) and
 * evaluateBadges (award decision), so the "am I there yet?" number the UI shows can
 * never disagree with what actually unlocks the badge.
 */
export function metricValue(
  metric: BadgeMetric,
  summary: JourneySummary,
  metrics: BadgeMetrics,
): number {
  switch (metric) {
    case 'lessons':
      return summary.completedLectures;
    case 'hours':
      return Math.floor(summary.totalSeconds / 3600);
    case 'streak':
      return summary.streak.longest;
    case 'active_days':
      return summary.activeDays;
    case 'series':
      return metrics.completedSeries;
    case 'quizzes':
      return metrics.quizzesPassed;
    case 'mastery':
      return metrics.hasMastery ? 1 : 0;
    case 'benefits':
      return metrics.benefitsCount;
    case 'benefit_days':
      return metrics.benefitDays;
    // Buddy metrics arrive in Phase 3 (buddy_goals); until then they read 0 and
    // the buddy-category badges simply stay locked.
    case 'buddy_start':
    case 'buddy_goals_done':
      return 0;
    default:
      return 0;
  }
}

/**
 * Full badge catalog merged with this user's earned state AND live progress
 * toward each locked badge (V20 · §9). One user_badges read + the two rollups.
 */
export async function getBadges(): Promise<Badge[]> {
  if (USE_MOCK) return mock.getBadges();
  const [{ data, error }, summary, metrics] = await Promise.all([
    supabase.from('user_badges').select('badge_key, earned_at'),
    getJourneySummary(),
    getBadgeMetrics(),
  ]);
  if (error) throw error;
  const earned = new Map((data ?? []).map((b) => [b.badge_key, b.earned_at]));
  return BADGES.map((def) => ({
    key: def.key,
    titleAr: def.titleAr,
    descAr: def.descAr,
    threshold: def.threshold,
    metric: def.metric,
    category: def.category,
    tier: def.tier,
    earned: earned.has(def.key),
    earnedAt: earned.get(def.key) ?? null,
    progress: metricValue(def.metric, summary, metrics),
  }));
}

/**
 * Re-evaluate the milestone badge catalog against the freshest server-side
 * rollup and persist any newly-earned badges; returns only the ones earned now.
 *
 * V11 · C: badges are re-evaluated at exactly two moments — a completion event
 * (from the save-progress seam) and رحلتي العلمية mount — never on a per-tick
 * playback save (the tick is now a single save_activity RPC). This is the diff
 * logic formerly inlined in recordListening. Badge rules stay in TS
 * (PLAN_PHASE2.md §3.2); one get_journey_summary RPC + one user_badges read.
 */
export async function evaluateBadges(): Promise<Badge[]> {
  if (USE_MOCK) return mock.evaluateBadges();

  const [summary, metrics, existing] = await Promise.all([
    getJourneySummary(),
    getBadgeMetrics(),
    supabase.from('user_badges').select('badge_key'),
  ]);
  const have = new Set((existing.data ?? []).map((b) => b.badge_key));

  const newly: Badge[] = [];
  const toInsert: { user_id: string; badge_key: string }[] = [];
  let userId: string | null = null;
  for (const def of BADGES) {
    if (have.has(def.key)) continue;
    if (metricValue(def.metric, summary, metrics) < def.threshold) continue;
    userId ??= await requireUserId();
    toInsert.push({ user_id: userId, badge_key: def.key });
    newly.push({
      key: def.key,
      titleAr: def.titleAr,
      descAr: def.descAr,
      threshold: def.threshold,
      metric: def.metric,
      category: def.category,
      tier: def.tier,
      earned: true,
      earnedAt: new Date().toISOString(),
      progress: metricValue(def.metric, summary, metrics),
    });
  }
  if (toInsert.length) {
    await supabase
      .from('user_badges')
      .upsert(toInsert, { onConflict: 'user_id,badge_key', ignoreDuplicates: true });
  }
  return newly;
}

/**
 * Record a listening delta against today + re-evaluate badges; returns the
 * newly-earned badges. Retained for back-compat / the mock contract — the V11
 * live save seam now credits listening inside `save_activity` (one RPC) and
 * calls {@link evaluateBadges} only on completion, so this is no longer on the
 * per-tick path. Live: rpc('record_meaningful_activity') then evaluateBadges().
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
  return evaluateBadges();
}
