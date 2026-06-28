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
import * as mock from '@/mock/api';
import type { Badge, GoalMetric, JourneySummary, WeeklyGoal } from './types';

export type {
  Badge,
  GoalMetric,
  JourneySummary,
  Streak,
  WeeklyGoal,
  WeekProgress,
} from './types';

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

/** Page-header stats: totals, current+longest streak, this-week progress. */
export async function getJourneySummary(): Promise<JourneySummary> {
  if (USE_MOCK) return mock.getJourneySummary();
  throw NOT_LIVE('getJourneySummary'); // → supabase.rpc('get_journey_summary')
}

/** The student's active weekly goal (for the editor). */
export async function getWeeklyGoal(): Promise<WeeklyGoal> {
  if (USE_MOCK) return mock.getWeeklyGoal();
  throw NOT_LIVE('getWeeklyGoal');
}

/** Set/replace the active weekly goal. */
export async function setWeeklyGoal(metric: GoalMetric, target: number): Promise<void> {
  if (USE_MOCK) return mock.setWeeklyGoal(metric, target);
  throw NOT_LIVE('setWeeklyGoal');
}

/** Full badge catalog merged with this user's earned state (incl. locked). */
export async function getBadges(): Promise<Badge[]> {
  if (USE_MOCK) return mock.getBadges();
  throw NOT_LIVE('getBadges');
}

/**
 * Record a listening delta against today + re-evaluate badges; returns the
 * newly-earned badges. Called from the save-progress seam, not from the player
 * UI. Live: supabase.rpc('record_daily_listening') then compare the badge
 * catalog against get_journey_summary and insert-on-conflict any new earns.
 */
export async function recordListening(args: {
  lectureId: string | null;
  deltaSec: number;
}): Promise<Badge[]> {
  if (USE_MOCK) return mock.recordListening(args);
  throw NOT_LIVE('recordListening');
}
