/**
 * Quiz data access — الاختبارات (Feature 12, PRD §12).
 *
 * The student side never touches quiz content tables directly: questions and
 * options (answer key stripped) come exclusively through the SECURITY DEFINER
 * RPCs in migration 0017, and grading happens server-side on submit. Admin
 * CRUD is direct table access gated by is_admin() RLS (attachments pattern).
 * While `USE_MOCK` is true everything returns inert empty shapes (buddy
 * pattern). Components never call supabase directly (CLAUDE.md).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type {
  AdminAttemptDetail,
  AdminQuizDetail,
  AdminQuizResultRow,
  AdminQuizRow,
  AdminQuizSummary,
  MyQuizStats,
  QuizAttemptData,
  QuizCard,
  QuizInput,
  QuizIntro,
  QuizQuestionInput,
  QuizResult,
  QuizStatus,
} from './types';

export type {
  AdminAttemptDetail,
  AdminQuizDetail,
  AdminQuizResultRow,
  AdminQuizRow,
  AdminQuizSummary,
  MyQuizStats,
  QuizAttemptData,
  QuizCard,
  QuizInput,
  QuizIntro,
  QuizQuestionInput,
  QuizResult,
  QuizStatus,
} from './types';

// ─── Student ─────────────────────────────────────────────────────────────────

type RawStatusRow = {
  id: string;
  title: string;
  description: string | null;
  pass_score: number;
  time_limit_sec: number | null;
  max_attempts: number | null;
  sort_order: number;
  question_count: number;
  total_score: number;
  attempts_used: number;
  attempts_left: number | null;
  best_score: number | null;
  passed: boolean;
  in_progress_attempt_id: string | null;
  last_result_attempt_id: string | null;
};

function deriveStatus(r: RawStatusRow): QuizStatus {
  if (r.in_progress_attempt_id) return 'in_progress';
  if (r.passed) return 'passed';
  if ((r.attempts_used ?? 0) === 0) return 'not_started';
  if (r.attempts_left === 0) return 'exhausted';
  return 'failed';
}

function mapCard(r: RawStatusRow): QuizCard {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    questionCount: r.question_count ?? 0,
    totalScore: r.total_score ?? 0,
    passScore: r.pass_score,
    timeLimitSec: r.time_limit_sec,
    maxAttempts: r.max_attempts,
    attemptsUsed: r.attempts_used ?? 0,
    attemptsLeft: r.attempts_left,
    bestScore: r.best_score,
    status: deriveStatus(r),
    inProgressAttemptId: r.in_progress_attempt_id,
    lastResultAttemptId: r.last_result_attempt_id,
    order: r.sort_order ?? 0,
  };
}

/** Published quizzes of one section node, with the caller's personal status. */
export async function getSectionQuizzes(sectionId: string): Promise<QuizCard[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_section_quizzes', {
    p_section_id: sectionId,
  });
  if (error) throw error;
  return ((data ?? []) as RawStatusRow[]).map(mapCard);
}

/** Pre-quiz intro (§12.2), or null when unpublished/missing. */
export async function getQuizIntro(quizId: string): Promise<QuizIntro | null> {
  if (USE_MOCK) return null;
  const { data, error } = await supabase.rpc('get_quiz_intro', {
    p_quiz_id: quizId,
  });
  if (error) throw error;
  const r = (data as (RawStatusRow & { section_id: string; section_title: string })[])?.[0];
  if (!r) return null;
  return {
    ...mapCard(r),
    sectionId: r.section_id,
    sectionTitle: r.section_title,
  };
}

/** Start (or resume) an attempt — gates + max_attempts enforced server-side. */
export async function startAttempt(quizId: string): Promise<string> {
  if (USE_MOCK) return '';
  const { data, error } = await supabase.rpc('start_quiz_attempt', {
    p_quiz_id: quizId,
  });
  if (error) throw error;
  return data as string;
}

/** Solver payload: questions + options WITHOUT the answer key, saved answers. */
export async function getAttemptQuestions(attemptId: string): Promise<QuizAttemptData> {
  if (USE_MOCK) {
    return {
      attemptId,
      quizId: '',
      quizTitle: '',
      timeLimitSec: null,
      remainingSec: null,
      submittedAt: null,
      questions: [],
    };
  }
  const { data, error } = await supabase.rpc('get_attempt_questions', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  return data as unknown as QuizAttemptData;
}

/** Save one answer (upsert; server refuses saves after the deadline). */
export async function saveAnswer(
  attemptId: string,
  questionId: string,
  optionId: string,
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('save_quiz_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_option_id: optionId,
  });
  if (error) throw error;
}

/** Grade server-side and finalize (idempotent on double-submit). */
export async function submitAttempt(attemptId: string): Promise<QuizResult> {
  if (USE_MOCK) return emptyResult(attemptId);
  const { data, error } = await supabase.rpc('submit_quiz_attempt', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  return data as unknown as QuizResult;
}

/** Re-open the result of an own, already-submitted attempt. */
export async function getAttemptResult(attemptId: string): Promise<QuizResult> {
  if (USE_MOCK) return emptyResult(attemptId);
  const { data, error } = await supabase.rpc('get_attempt_result', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  return data as unknown as QuizResult;
}

/** Quiet Journey line (§12.4): personal attempted/passed counts. */
export async function getMyQuizStats(): Promise<MyQuizStats> {
  if (USE_MOCK) return { attempted: 0, passed: 0 };
  const { data, error } = await supabase.rpc('get_my_quiz_stats');
  if (error) throw error;
  const r = data?.[0];
  return { attempted: r?.attempted ?? 0, passed: r?.passed ?? 0 };
}

function emptyResult(attemptId: string): QuizResult {
  return {
    attemptId,
    quizId: '',
    quizTitle: '',
    submittedAt: null,
    showResult: false,
    showCorrectAnswers: false,
    attemptsLeft: null,
    canRetry: false,
    questionCount: 0,
    score: null,
    passed: null,
    totalScore: null,
    passScore: null,
    correctCount: null,
    wrongCount: null,
    details: null,
  };
}

// ─── Admin ───────────────────────────────────────────────────────────────────

/** All quizzes (drafts included) with question counts, newest first. */
export async function adminListQuizzes(): Promise<AdminQuizRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, status, pass_score, order, updated_at, section_id, sections(title), quiz_questions(count)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const section = Array.isArray(r.sections) ? r.sections[0] : (r.sections as any);
    const counts = r.quiz_questions as unknown as { count: number }[] | null;
    return {
      id: r.id,
      title: r.title,
      sectionId: r.section_id,
      sectionTitle: section?.title ?? null,
      status: r.status as 'draft' | 'published',
      questionCount: counts?.[0]?.count ?? 0,
      passScore: r.pass_score,
      order: r.order,
      updatedAt: r.updated_at,
    };
  });
}

/** Full quiz incl. questions/options + answer key, for the editor. */
export async function adminGetQuiz(quizId: string): Promise<AdminQuizDetail> {
  if (USE_MOCK) throw new Error('غير متاح');
  const [{ data: quiz, error: qErr }, { data: questions, error: quErr }] = await Promise.all([
    supabase
      .from('quizzes')
      .select('id, section_id, title, description, pass_score, time_limit_sec, max_attempts, show_result, show_correct_answers, status, order')
      .eq('id', quizId)
      .single(),
    supabase
      .from('quiz_questions')
      .select('id, text, points, order, quiz_options(id, text, is_correct, order)')
      .eq('quiz_id', quizId)
      .order('order'),
  ]);
  if (qErr || !quiz) throw qErr ?? new Error('quiz not found');
  if (quErr) throw quErr;
  return {
    id: quiz.id,
    sectionId: quiz.section_id,
    title: quiz.title,
    description: quiz.description,
    passScore: quiz.pass_score,
    timeLimitSec: quiz.time_limit_sec,
    maxAttempts: quiz.max_attempts,
    showResult: quiz.show_result,
    showCorrectAnswers: quiz.show_correct_answers,
    status: quiz.status as 'draft' | 'published',
    order: quiz.order,
    questions: (questions ?? []).map((q) => ({
      id: q.id,
      text: q.text,
      points: q.points,
      order: q.order,
      options: (q.quiz_options ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((o) => ({
          id: o.id,
          text: o.text,
          isCorrect: o.is_correct,
          order: o.order,
        })),
    })),
  };
}

/**
 * Diff-upsert questions/options instead of delete-and-recreate: rows that keep
 * their id survive, so existing student attempt answers (FK cascade) aren't
 * wiped by an unrelated edit.
 */
async function writeQuestions(quizId: string, questions: QuizQuestionInput[]): Promise<void> {
  const { data: existing, error: exErr } = await supabase
    .from('quiz_questions')
    .select('id')
    .eq('quiz_id', quizId);
  if (exErr) throw exErr;
  const keepQ = new Set(questions.filter((q) => q.id).map((q) => q.id!));
  const removedQ = (existing ?? []).map((r) => r.id).filter((id) => !keepQ.has(id));
  if (removedQ.length > 0) {
    const { error } = await supabase.from('quiz_questions').delete().in('id', removedQ);
    if (error) throw error;
  }

  for (const q of questions) {
    let questionId = q.id ?? null;
    if (questionId) {
      const { error } = await supabase
        .from('quiz_questions')
        .update({ text: q.text, points: q.points, order: q.order })
        .eq('id', questionId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('quiz_questions')
        .insert({ quiz_id: quizId, text: q.text, points: q.points, order: q.order })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('insert question failed');
      questionId = data.id;
    }

    const { data: exOpts, error: oErr } = await supabase
      .from('quiz_options')
      .select('id')
      .eq('question_id', questionId);
    if (oErr) throw oErr;
    const keepO = new Set(q.options.filter((o) => o.id).map((o) => o.id!));
    const removedO = (exOpts ?? []).map((r) => r.id).filter((id) => !keepO.has(id));
    if (removedO.length > 0) {
      const { error } = await supabase.from('quiz_options').delete().in('id', removedO);
      if (error) throw error;
    }
    for (const o of q.options) {
      if (o.id) {
        const { error } = await supabase
          .from('quiz_options')
          .update({ text: o.text, is_correct: o.isCorrect, order: o.order })
          .eq('id', o.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('quiz_options')
          .insert({ question_id: questionId, text: o.text, is_correct: o.isCorrect, order: o.order });
        if (error) throw error;
      }
    }
  }
}

/** Admin: create a quiz with its questions. Returns the new quiz id. */
export async function createQuiz(input: QuizInput, questions: QuizQuestionInput[]): Promise<string> {
  if (USE_MOCK) return '';
  const { data, error } = await supabase
    .from('quizzes')
    .insert({
      section_id: input.sectionId,
      title: input.title,
      description: input.description,
      pass_score: input.passScore,
      time_limit_sec: input.timeLimitSec,
      max_attempts: input.maxAttempts,
      show_result: input.showResult,
      show_correct_answers: input.showCorrectAnswers,
      status: input.status,
      order: input.order,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('create quiz failed');
  await writeQuestions(data.id, questions);
  return data.id;
}

/** Admin: update a quiz + diff-upsert its questions. */
export async function updateQuiz(
  quizId: string,
  input: QuizInput,
  questions: QuizQuestionInput[],
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase
    .from('quizzes')
    .update({
      section_id: input.sectionId,
      title: input.title,
      description: input.description,
      pass_score: input.passScore,
      time_limit_sec: input.timeLimitSec,
      max_attempts: input.maxAttempts,
      show_result: input.showResult,
      show_correct_answers: input.showCorrectAnswers,
      status: input.status,
      order: input.order,
    })
    .eq('id', quizId);
  if (error) throw error;
  await writeQuestions(quizId, questions);
}

/** Admin: delete a quiz (questions/options/attempts cascade). */
export async function deleteQuiz(quizId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) throw error;
}

/** Admin: flip draft/published. */
export async function setQuizStatus(quizId: string, status: 'draft' | 'published'): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.from('quizzes').update({ status }).eq('id', quizId);
  if (error) throw error;
}

/** §12.5 summary tiles (server-side rollup incl. not-taken followers). */
export async function getQuizResultsSummary(quizId: string): Promise<AdminQuizSummary> {
  if (USE_MOCK) {
    return {
      entered: 0,
      passedCount: 0,
      failedCount: 0,
      incompleteCount: 0,
      notTaken: 0,
      avgScore: null,
      maxScore: null,
      minScore: null,
    };
  }
  const { data, error } = await supabase.rpc('get_quiz_results_summary', {
    p_quiz_id: quizId,
  });
  if (error) throw error;
  const r = data?.[0];
  return {
    entered: r?.entered ?? 0,
    passedCount: r?.passed_count ?? 0,
    failedCount: r?.failed_count ?? 0,
    incompleteCount: r?.incomplete_count ?? 0,
    notTaken: r?.not_taken ?? 0,
    avgScore: r?.avg_score != null ? Number(r.avg_score) : null,
    maxScore: r?.max_score ?? null,
    minScore: r?.min_score ?? null,
  };
}

/** §12.5 per-student rows. */
export async function listQuizResultRows(quizId: string): Promise<AdminQuizResultRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('list_quiz_result_rows', {
    p_quiz_id: quizId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    status: r.status as AdminQuizResultRow['status'],
    bestScore: r.best_score,
    attemptsUsed: r.attempts_used,
    lastAttemptAt: r.last_attempt_at,
    lastAttemptId: r.last_attempt_id,
  }));
}

/** §12.5 drill-down: one attempt with per-question right/wrong. */
export async function getAttemptDetail(attemptId: string): Promise<AdminAttemptDetail> {
  if (USE_MOCK) throw new Error('غير متاح');
  const { data, error } = await supabase.rpc('get_attempt_detail', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  return data as unknown as AdminAttemptDetail;
}
