/**
 * Personal progress. Always scoped to the signed-in user. Progress never rolls
 * sideways between branches of the tree, and a lecture is never un-completed.
 */
import { COMPLETE_THRESHOLD, MAX_LISTEN_TICK_SEC, USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import {
  cancelResumeReminder,
  cancelSeriesReminder,
  presentCompletionPraise,
  presentGoalCongrats,
  remindersSupported,
  scheduleSeriesReminder,
} from '@/lib/notifications';
import { tryClaimGoalCongrats } from './notifications';
import * as mock from '@/mock/api';
import { recordListening } from './journey';
import { defaultNotificationEnabled, type Badge, type NotificationType } from './types';

export type LectureProgress = { position_sec: number; completed: boolean } | null;

/**
 * Whether the user has any in-progress (not completed, position > 0) lesson —
 * i.e. a resume reminder is the relevant nudge. Used by the §7 priority
 * dispatcher to let resume outrank the daily remembrance (when true, the daily
 * defers). Cheap existence check (limit 1).
 */
export async function hasResumableLesson(): Promise<boolean> {
  if (USE_MOCK) return mock.hasResumableLesson();
  const { data } = await supabase
    .from('user_lecture_progress')
    .select('lecture_id')
    .eq('completed', false)
    .gt('position_sec', 0)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * The most-recent in-progress lesson as a resume target — what the floating
 * bubble nudges toward. Returns lectureId + paused second (for the deep-link),
 * the lesson `title`, plus `durationSec` and `updatedAt` so the caller can pick
 * the resume phrase variant (general / near-completion / long-gap) the same way
 * the resume reminder ladder does. Null if none.
 */
export type ResumeTarget = {
  lectureId: string;
  positionSec: number;
  title: string;
  durationSec: number;
  updatedAt: string;
};

export async function getResumeTarget(): Promise<ResumeTarget | null> {
  if (USE_MOCK) return mock.getResumeTarget();
  const { data } = await supabase
    .from('user_lecture_progress')
    .select('lecture_id, position_sec, updated_at, lectures(title, duration_sec)')
    .eq('completed', false)
    .gt('position_sec', 0)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const lec = Array.isArray(data.lectures) ? data.lectures[0] : data.lectures;
  const l = lec as { title?: string; duration_sec?: number | null } | null;
  return {
    lectureId: data.lecture_id,
    positionSec: data.position_sec,
    title: l?.title ?? 'تابع درسك',
    durationSec: l?.duration_sec ?? 0,
    updatedAt: data.updated_at,
  };
}

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

  // position_sec is an INTEGER column — expo-audio reports a fractional
  // currentTime, so round (else PostgREST rejects "16.532" with a 22P02 and the
  // in-progress save is silently lost, breaking resume-from-position).
  const posInt = Math.max(0, Math.round(positionSec));
  const { error } = await supabase
    .from('user_lecture_progress')
    .upsert(
      { user_id: user.id, lecture_id: lectureId, position_sec: posInt, completed },
      { onConflict: 'user_id,lecture_id' },
    );
  if (error) throw error;

  // Forward movement only, capped — a scrub-forward can't inflate listening time.
  // Rounded: record_daily_listening's p_seconds is an INTEGER column too.
  const delta = Math.max(0, Math.round(Math.min(positionSec - prevPos, MAX_LISTEN_TICK_SEC)));

  // Local notifications (fire-and-forget; a scheduling error never blocks the save).
  // `firstTouch` (no prior progress row) marks "just started a lesson" — the other
  // moment (besides completion) the unfinished-series reminder is (re)evaluated.
  void maybeUpdateReminders(
    lectureId,
    completed,
    justCompleted,
    posInt,
    durationSec,
    !prev,
  );

  // Re-evaluate badges only when state can actually change: a new listened
  // delta (streak/active-days) or a fresh completion (completed-count badges).
  // The server decides whether the day becomes streak-meaningful (26.1):
  // today's accumulated seconds ≥ 120 or a completion — never per-tick JS.
  if (delta > 0 || justCompleted) {
    return recordListening({ lectureId, deltaSec: delta, completed: justCompleted });
  }
  return [];
}

/**
 * Drive the local notifications off the single save seam (all gated by their
 * per-type pref, a missing row = the type's default):
 *  - completion praise — immediate, only on the crossing into completed.
 *  - series reminder  — on completion, continue the section if more remain;
 *    otherwise cancel it (the student finished the last lesson).
 *
 * The resume ladder is NO LONGER scheduled here: device TIME_INTERVAL alarms
 * are dropped by Samsung Doze, so V7 moved it server-side (migration 0035,
 * dispatch_resume_nudges → push). This seam only CANCELS any pending device
 * ladder (from this or older app versions) so stale local reminders die out.
 *
 * Fully best-effort: short-circuits on platforms where reminders can't fire so
 * we don't run the pref/title lookups on web / simulator, and swallows all
 * errors — a missed notification must never break a playback save.
 */
async function maybeUpdateReminders(
  lectureId: string,
  completed: boolean,
  justCompleted: boolean,
  positionSec: number,
  durationSec: number,
  firstTouch: boolean,
): Promise<void> {
  if (!remindersSupported()) return;
  try {
    // Relevant prefs in one round-trip (missing row = the type's default).
    const { data: prefRows } = await supabase
      .from('notification_prefs')
      .select('type, enabled')
      .in('type', ['completion_praise', 'resume_series', 'weekly_goal']);
    const overrides = new Map((prefRows ?? []).map((r) => [r.type, r.enabled]));
    const prefOn = (type: NotificationType) =>
      overrides.has(type) ? overrides.get(type)! : defaultNotificationEnabled(type);

    // Lecture title + section context in one round-trip.
    const { data: lec } = await supabase
      .from('lectures')
      .select('title, section_id, order, sections(title)')
      .eq('id', lectureId)
      .maybeSingle();
    const title = lec?.title ?? 'تابع درسك';
    const sectionId = lec?.section_id ?? null;
    const section = Array.isArray(lec?.sections) ? lec?.sections[0] : lec?.sections;
    const sectionTitle = (section as { title?: string } | null)?.title ?? 'سلسلتك العلمية';

    // 1) Clear any pending DEVICE resume ladder for this lecture — the server
    //    cron (0035) owns resume nudges now, and touching the lecture resets
    //    its idle clock server-side automatically (updated_at).
    await cancelResumeReminder(lectureId);

    // 2) Unfinished-series reminder — for ANY started-but-unfinished section in
    //    this lecture's subtree, not only on completion. Re-evaluated when a
    //    lesson is just started or just completed (the moments the remaining
    //    count changes) to avoid an RPC on every 5s in-progress tick.
    if (sectionId && (firstTouch || justCompleted)) {
      const { data: roll } = await supabase
        .rpc('get_section_rollup', { p_section_id: sectionId })
        .maybeSingle();
      const total = Number(roll?.total_lectures ?? 0);
      const done = Number(roll?.completed_lectures ?? 0);
      const remaining = Math.max(0, total - done);
      if (remaining > 0) {
        if (prefOn('resume_series')) {
          await scheduleSeriesReminder(sectionId, sectionTitle, remaining);
        }
      } else {
        await cancelSeriesReminder(sectionId); // section finished
      }
    }

    // 3) Completion praise (immediate, only on the crossing into completed).
    if (justCompleted && prefOn('completion_praise')) {
      await presentCompletionPraise(title);
    }

    // 4) Weekly-goal completion-congrats — local & immediate the first time the
    //    week's target is crossed (server claims it once/week; the time-based
    //    midweek/2-days nudges are cron-push, not here).
    if (justCompleted && prefOn('weekly_goal')) {
      if (await tryClaimGoalCongrats()) await presentGoalCongrats();
    }
  } catch {
    // Non-fatal — a missed notification must never break playback saves.
  }
}
