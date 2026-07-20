/**
 * «ملخص إتمام السلسلة» series-completion summary (V20 · Feature A).
 *
 * One RPC (get_series_completion_summary, migration 0116) rolls up the student's
 * whole journey through a series (the recursive subtree of one section): lessons,
 * ACTUAL listening minutes in that series, quizzes, فوائد + ملاحظات + bookmarks
 * they wrote, and the start/finish dates. The closing page renders these as quiet
 * rows. Components never call supabase directly (CLAUDE.md); the hook calls this.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type SeriesCompletionSummary = {
  totalLectures: number;
  completedLectures: number;
  listeningSeconds: number;
  quizAttempts: number;
  quizzesTaken: number;
  quizBestTotal: number;
  quizPointsTotal: number;
  benefitsCount: number;
  notesCount: number;
  bookmarksCount: number;
  startedAt: string | null;
  completedAt: string | null;
};

const EMPTY: SeriesCompletionSummary = {
  totalLectures: 0,
  completedLectures: 0,
  listeningSeconds: 0,
  quizAttempts: 0,
  quizzesTaken: 0,
  quizBestTotal: 0,
  quizPointsTotal: 0,
  benefitsCount: 0,
  notesCount: 0,
  bookmarksCount: 0,
  startedAt: null,
  completedAt: null,
};

export async function getSeriesCompletionSummary(
  sectionId: string,
): Promise<SeriesCompletionSummary> {
  if (USE_MOCK || !sectionId) return EMPTY;
  const { data, error } = await supabase.rpc('get_series_completion_summary', {
    p_section_id: sectionId,
  });
  if (error) throw error;
  const r = data?.[0];
  if (!r) return EMPTY;
  return {
    totalLectures: Number(r.total_lectures ?? 0),
    completedLectures: Number(r.completed_lectures ?? 0),
    listeningSeconds: Number(r.listening_seconds ?? 0),
    quizAttempts: Number(r.quiz_attempts ?? 0),
    quizzesTaken: Number(r.quizzes_taken ?? 0),
    quizBestTotal: Number(r.quiz_best_total ?? 0),
    quizPointsTotal: Number(r.quiz_points_total ?? 0),
    benefitsCount: Number(r.benefits_count ?? 0),
    notesCount: Number(r.notes_count ?? 0),
    bookmarksCount: Number(r.bookmarks_count ?? 0),
    startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null,
  };
}

/** True once every published lesson in the series subtree is completed. */
export function isSeriesComplete(s: SeriesCompletionSummary): boolean {
  return s.totalLectures > 0 && s.completedLectures >= s.totalLectures;
}

/**
 * One shared فائدة in a series, with the lesson it belongs to. Anonymous — the
 * author never crosses the wire (get_series_benefits, migration 0117); `isMine`
 * is the only ownership signal, so the review page can mark «فائدتك».
 */
export type SeriesBenefit = {
  id: string;
  lectureId: string;
  lectureTitle: string;
  lectureOrder: number;
  body: string;
  isMine: boolean;
  createdAt: string;
};

/** All visible فوائد across the series subtree, ordered by lesson then recency. */
export async function getSeriesBenefits(sectionId: string): Promise<SeriesBenefit[]> {
  if (USE_MOCK || !sectionId) return [];
  const { data, error } = await supabase.rpc('get_series_benefits', {
    p_section_id: sectionId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    lectureId: r.lecture_id,
    lectureTitle: r.lecture_title,
    lectureOrder: Number(r.lecture_order ?? 0),
    body: r.body,
    isMine: !!r.is_mine,
    createdAt: r.created_at,
  }));
}
