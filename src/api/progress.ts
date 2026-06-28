/**
 * Personal progress. Always scoped to the signed-in user. Progress never rolls
 * sideways between branches of the tree, and a lecture is never un-completed.
 */
import { USE_MOCK } from '@/config';
import * as mock from '@/mock/api';
import type { Badge } from './types';

export type LectureProgress = { position_sec: number; completed: boolean } | null;

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

/** The current user's progress for a lecture, if any (for resume). */
export async function getLectureProgress(lectureId: string): Promise<LectureProgress> {
  if (USE_MOCK) return mock.getLectureProgress(lectureId);
  throw NOT_LIVE('getLectureProgress');
}

/**
 * Upsert playback position; flips `completed` once {@link COMPLETE_THRESHOLD}
 * (90%) is reached. Called debounced (~5s) during playback and on completion.
 *
 * This is also the single integration point for the رحلتي العلمية daily feed
 * (PLAN_PHASE2.md §3.3): it credits the listened delta to today's
 * `daily_listening` and re-evaluates badges, returning any newly-earned ones so
 * a caller may surface a calm toast. The player calls this fire-and-forget and
 * ignores the result; the journey screen refetches its own rollups.
 */
export async function saveLectureProgress(args: {
  lectureId: string;
  positionSec: number;
  durationSec: number;
}): Promise<Badge[]> {
  if (USE_MOCK) return mock.saveLectureProgress(args);
  throw NOT_LIVE('saveLectureProgress');
}
