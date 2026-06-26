/**
 * Lecture data access for playback (player + downloads).
 */
import { USE_MOCK } from '@/config';
import * as mock from '@/mock/api';
import type { LectureCard, LecturePlayback } from './types';

export type { LectureCard, LecturePlayback } from './types';

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

/** Everything the player needs for one lecture (incl. resume position + audio URL). */
export async function getLecturePlayback(lectureId: string): Promise<LecturePlayback> {
  if (USE_MOCK) return mock.getLecturePlayback(lectureId);
  throw NOT_LIVE('getLecturePlayback');
}

/** Lecture cards for a set of ids — used by the downloads page. */
export async function getLecturesByIds(ids: string[]): Promise<LectureCard[]> {
  if (USE_MOCK) return mock.getLecturesByIds(ids);
  throw NOT_LIVE('getLecturesByIds');
}
