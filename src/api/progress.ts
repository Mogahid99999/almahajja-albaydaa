/**
 * Personal progress. Always scoped to the signed-in user. Progress never rolls
 * sideways between branches of the tree, and a lecture is never un-completed.
 */
import { COMPLETE_THRESHOLD, USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import type { Badge } from './types';

export type LectureProgress = { position_sec: number; completed: boolean } | null;

/** The current user's progress for a lecture, if any (for resume). */
export async function getLectureProgress(lectureId: string): Promise<LectureProgress> {
  if (USE_MOCK) return mock.getLectureProgress(lectureId);
  const { data } = await supabase
    .from('user_lecture_progress')
    .select('position_sec, completed')
    .eq('lecture_id', lectureId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Upsert playback position; flips `completed` once {@link COMPLETE_THRESHOLD}
 * (90%) is reached. Called debounced (~5s) during playback and on completion.
 *
 * Also credits the listened delta to today's `daily_listening` row for the
 * رحلتي العلمية feature. Badge re-evaluation is deferred until the journey
 * page loads (avoids a round-trip on every progress tick).
 */
export async function saveLectureProgress(args: {
  lectureId: string;
  positionSec: number;
  durationSec: number;
}): Promise<Badge[]> {
  if (USE_MOCK) return mock.saveLectureProgress(args);

  const { lectureId, positionSec, durationSec } = args;
  const completed =
    durationSec > 0 && positionSec / durationSec >= COMPLETE_THRESHOLD;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { error } = await supabase
    .from('user_lecture_progress')
    .upsert(
      { user_id: user.id, lecture_id: lectureId, position_sec: positionSec, completed },
      { onConflict: 'user_id,lecture_id' },
    );
  if (error) throw error;

  // Credit today's daily_listening (best-effort; never throws)
  const today = new Date().toISOString().slice(0, 10);
  try {
    await supabase
      .from('daily_listening')
      .upsert(
        { user_id: user.id, day: today, seconds_listened: positionSec, lecture_ids: [lectureId] },
        { onConflict: 'user_id,day' },
      );
  } catch {
    // non-critical
  }

  // Badge evaluation happens server-side on the journey page load via RPC.
  return [];
}
