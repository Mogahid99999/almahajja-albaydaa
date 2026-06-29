/**
 * Personal progress. Always scoped to the signed-in user. Progress never rolls
 * sideways between branches of the tree, and a lecture is never un-completed.
 */
import { COMPLETE_THRESHOLD, MAX_LISTEN_TICK_SEC, USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import {
  cancelResumeReminder,
  remindersSupported,
  scheduleResumeReminder,
} from '@/lib/notifications';
import * as mock from '@/mock/api';
import { recordListening } from './journey';
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
 * This is the single integration point for two Phase-2 features (the player UI
 * is untouched):
 *  - رحلتي العلمية: credits the forward-listened delta to today's
 *    `daily_listening` and re-evaluates milestone badges, returning any just
 *    earned (so the caller can show a calm acknowledgement).
 *  - الإشعارات: schedules / cancels the local "لديك درس لم تكمله" resume
 *    reminder, gated on the `resume_reminder` pref.
 *
 * Mirrors the mock contract in src/mock/api.ts exactly.
 */
export async function saveLectureProgress(args: {
  lectureId: string;
  positionSec: number;
  durationSec: number;
}): Promise<Badge[]> {
  if (USE_MOCK) return mock.saveLectureProgress(args);

  const { lectureId, positionSec, durationSec } = args;
  const reachedThreshold =
    durationSec > 0 && positionSec / durationSec >= COMPLETE_THRESHOLD;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  // Previous position + completion: needed to compute the listened delta and to
  // honour "a lecture is never un-completed" (rewinding must not clear it).
  const { data: prev } = await supabase
    .from('user_lecture_progress')
    .select('position_sec, completed')
    .eq('lecture_id', lectureId)
    .maybeSingle();
  const prevPos = prev?.position_sec ?? 0;
  const wasCompleted = prev?.completed ?? false;
  const completed = reachedThreshold || wasCompleted;
  const justCompleted = completed && !wasCompleted;

  const { error } = await supabase
    .from('user_lecture_progress')
    .upsert(
      { user_id: user.id, lecture_id: lectureId, position_sec: positionSec, completed },
      { onConflict: 'user_id,lecture_id' },
    );
  if (error) throw error;

  // Forward movement only, capped — a scrub-forward can't inflate listening time.
  const delta = Math.max(0, Math.min(positionSec - prevPos, MAX_LISTEN_TICK_SEC));

  // Resume reminder (fire-and-forget; a scheduling error never blocks the save).
  void maybeUpdateResumeReminder(lectureId, completed);

  // Re-evaluate badges only when state can actually change: a new listened
  // delta (streak/active-days) or a fresh completion (completed-count badges).
  if (delta > 0 || justCompleted) {
    return recordListening({ lectureId, deltaSec: delta });
  }
  return [];
}

/**
 * Schedule (in-progress) or cancel (completed) the local resume reminder for a
 * lecture, gated on the `resume_reminder` pref (a missing row = ON). Fully
 * best-effort: short-circuits on platforms where reminders can't fire so we
 * don't run the pref/title lookups on web / simulator, and swallows all errors.
 */
async function maybeUpdateResumeReminder(
  lectureId: string,
  completed: boolean,
): Promise<void> {
  if (!remindersSupported()) return;
  try {
    const { data: pref } = await supabase
      .from('notification_prefs')
      .select('enabled')
      .eq('type', 'resume_reminder')
      .maybeSingle();
    const enabled = pref ? pref.enabled : true; // missing row = ON
    if (!enabled) return;

    if (completed) {
      await cancelResumeReminder(lectureId);
      return;
    }
    const { data: lec } = await supabase
      .from('lectures')
      .select('title')
      .eq('id', lectureId)
      .maybeSingle();
    await scheduleResumeReminder(lectureId, lec?.title ?? 'تابع درسك');
  } catch {
    // Non-fatal — a missed reminder must never break playback saves.
  }
}
