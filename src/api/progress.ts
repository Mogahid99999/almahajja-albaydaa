/**
 * Personal progress. Always scoped to the signed-in user. Progress never rolls
 * sideways between branches of the tree, and a lecture is never un-completed.
 */
import { MAX_LISTEN_TICK_SEC, USE_MOCK } from '@/config';
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
import { evaluateBadges } from './journey';
import { enqueueActivity, localDay } from '@/lib/outbox';
import { isOnlineSync } from '@/lib/connectivity';
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
 * Persist one playback tick in ONE round-trip (V11 · C). Called debounced (~5s)
 * during playback, on pause/stop, and on completion.
 *
 * Where the pre-V11 seam made ~5 calls per tick (select-prev + upsert +
 * record_meaningful_activity + get_journey_summary + user_badges), this is a
 * single `save_activity` RPC: it upserts the position, credits the forward
 * listened delta to `daily_listening` and flips the streak day, server-side. The
 * caller ({@link import('@/lib/audioController')}) supplies the delta (computed
 * from the last saved position — no prev SELECT), the completion flags and
 * `firstTouch`, since it owns the track lifecycle.
 *
 * Offline (or a failed write) → the tick is QUEUED for day-accurate replay
 * instead of dropped; the on-device sidecar still holds the resume position.
 * Badges are re-evaluated ONLY on a completion event (never per tick); the local
 * resume/series/praise reminders keep their existing gating.
 *
 * Passes the mock contract through untouched (src/mock/api.ts reads the same
 * lectureId/positionSec/durationSec and ignores the extra fields).
 */
export async function saveLectureProgress(args: {
  lectureId: string;
  positionSec: number;
  durationSec: number;
  /** Forward seconds listened since the last saved position (caller-computed). */
  deltaSec: number;
  /** Threshold reached (or forced on finish) — server OR-merges, never un-completes. */
  completed: boolean;
  /** completed && not-already-reported-this-track — the false→true crossing. */
  justCompleted: boolean;
  /** No save yet for this track this session — the "just started" moment. */
  firstTouch: boolean;
}): Promise<Badge[]> {
  if (USE_MOCK) return mock.saveLectureProgress(args);

  const { lectureId, positionSec, durationSec, completed, justCompleted, firstTouch } = args;
  // position_sec/duration_sec are INTEGER columns and expo-audio reports a
  // fractional currentTime — round (else PostgREST 22P02 drops the save).
  const posInt = Math.max(0, Math.round(positionSec));
  const durInt = Math.max(0, Math.round(durationSec));
  // Forward movement only, capped — a scrub-forward can't inflate listening time.
  const delta = Math.max(0, Math.round(Math.min(args.deltaSec, MAX_LISTEN_TICK_SEC)));

  const enqueue = () =>
    enqueueActivity({
      lectureId,
      day: localDay(),
      positionSec: posInt,
      durationSec: durInt,
      deltaSec: delta,
      completed,
    });

  // Offline → queue and return; the doomed RPC is never attempted.
  if (!isOnlineSync()) {
    await enqueue();
    return [];
  }

  const { error } = await supabase.rpc('save_activity', {
    p_lecture_id: lectureId,
    p_position_sec: posInt,
    p_duration_sec: durInt,
    p_delta_sec: delta,
    p_completed: completed,
  });
  if (error) {
    // Thought we were online but the write failed — queue for replay, don't drop it.
    await enqueue();
    return [];
  }

  // Local notifications (fire-and-forget; a scheduling error never blocks the save).
  // Gated on the two meaningful moments so a steady in-progress tick is exactly ONE
  // network call (save_activity) — the prefs/title reads inside only matter when a
  // lesson is just started or just completed (V11 · C).
  if (firstTouch || justCompleted) {
    void maybeUpdateReminders(lectureId, completed, justCompleted, posInt, durInt, firstTouch);
  }

  // Badges re-evaluate ONLY on a completion event now (never per in-progress tick);
  // رحلتي العلمية mount re-evaluates too, as a catch-up (see useJourney).
  if (justCompleted) return evaluateBadges();
  return [];
}

/**
 * Replay one queued offline activity entry for the EXACT day it happened (V11 · B).
 * `p_is_replay=true` makes the server take greatest() for position (a stale entry
 * never rewinds newer online progress) and clamp the coalesced delta to the 6h/day
 * bound; `p_day` credits `daily_listening` for that day so the streak math is
 * day-accurate. Called only by the outbox flush.
 */
export async function replayActivity(e: {
  lectureId: string;
  day: string;
  positionSec: number;
  durationSec: number;
  deltaSec: number;
  completed: boolean;
}): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('save_activity', {
    p_lecture_id: e.lectureId,
    p_position_sec: Math.max(0, Math.round(e.positionSec)),
    p_duration_sec: Math.max(0, Math.round(e.durationSec)),
    p_delta_sec: Math.max(0, Math.round(e.deltaSec)),
    p_completed: e.completed,
    p_day: e.day,
    p_is_replay: true,
  });
  if (error) throw error;
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
