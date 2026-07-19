/**
 * «حصاد الرحلة» harvest data access (V20 · §8). One RPC per range
 * (get_harvest, migration 0111): the fruit of the journey this week / month / all.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type HarvestRange = 'week' | 'month' | 'all';

export type Harvest = {
  completedLessons: number;
  totalSeconds: number;
  activeDays: number;
  completedSeries: number;
  quizzesPassed: number;
  benefitsWritten: number;
};

const EMPTY: Harvest = {
  completedLessons: 0,
  totalSeconds: 0,
  activeDays: 0,
  completedSeries: 0,
  quizzesPassed: 0,
  benefitsWritten: 0,
};

export async function getHarvest(range: HarvestRange): Promise<Harvest> {
  if (USE_MOCK) return EMPTY;
  const { data, error } = await supabase.rpc('get_harvest', { p_range: range });
  if (error) throw error;
  const r = data?.[0];
  if (!r) return EMPTY;
  return {
    completedLessons: Number(r.completed_lessons ?? 0),
    totalSeconds: Number(r.total_seconds ?? 0),
    activeDays: Number(r.active_days ?? 0),
    completedSeries: Number(r.completed_series ?? 0),
    quizzesPassed: Number(r.quizzes_passed ?? 0),
    benefitsWritten: Number(r.benefits_written ?? 0),
  };
}
