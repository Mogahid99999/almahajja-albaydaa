/**
 * «سجل النشاط» activity calendar data access (V20 · §7). One RPC per month
 * (get_activity_calendar, migration 0110) returning per-day activity + a colour
 * level. Personal, calm — a gap is just an empty cell, never a reproach.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type ActivityLevel = 'none' | 'light' | 'full' | 'gold';

export type ActivityDay = {
  day: string; // YYYY-MM-DD
  secondsListened: number;
  lessonsCompleted: number;
  quizzesPassed: number;
  benefitsWritten: number;
  level: ActivityLevel;
};

/** Active days for the month containing `monthAnchor` (any date in that month). */
export async function getActivityCalendar(monthAnchor: string): Promise<ActivityDay[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_activity_calendar', {
    p_month: monthAnchor,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    day: r.day,
    secondsListened: Number(r.seconds_listened ?? 0),
    lessonsCompleted: Number(r.lessons_completed ?? 0),
    quizzesPassed: Number(r.quizzes_passed ?? 0),
    benefitsWritten: Number(r.benefits_written ?? 0),
    level: (r.level as ActivityLevel) ?? 'none',
  }));
}
