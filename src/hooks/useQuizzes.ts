import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminGetQuiz,
  adminListQuizzes,
  createQuiz,
  deleteQuiz,
  getAttemptDetail,
  getAttemptQuestions,
  getAttemptResult,
  getMyQuizStats,
  getQuizIntro,
  getQuizResultsSummary,
  getSectionQuizzes,
  gradeAttempt,
  listPendingGradings,
  listQuizResultRows,
  saveAnswer,
  saveTextAnswer,
  setQuizAvailability,
  setQuizStatus,
  startAttempt,
  submitAttempt,
  updateQuiz,
} from '@/api/quizzes';
import type { QuizInput, QuizQuestionInput, QuizResult, QuizWrittenGrade } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';

// ─── Student ─────────────────────────────────────────────────────────────────

export function useSectionQuizzes(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.sectionQuizzes(sectionId),
    queryFn: () => getSectionQuizzes(sectionId),
    enabled: !!sectionId,
  });
}

export function useQuizIntro(quizId: string) {
  return useQuery({
    queryKey: queryKeys.quizIntro(quizId),
    queryFn: () => getQuizIntro(quizId),
    enabled: !!quizId,
  });
}

export function useAttemptQuestions(attemptId: string) {
  return useQuery({
    queryKey: queryKeys.quizAttempt(attemptId),
    queryFn: () => getAttemptQuestions(attemptId),
    enabled: !!attemptId,
  });
}

export function useAttemptResult(attemptId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.quizResult(attemptId),
    queryFn: () => getAttemptResult(attemptId),
    enabled: (options?.enabled ?? true) && !!attemptId,
    // 0166: a result awaiting a grader can turn final at any moment (often
    // opened straight from the «تم تصحيح اختبارك» notification) — never serve
    // a cached «بانتظار التصحيح» as fresh.
    staleTime: (q) => (q.state.data?.gradingStatus === 'pending' ? 0 : 30 * 60_000),
  });
}

export function useMyQuizStats(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.myQuizStats,
    queryFn: getMyQuizStats,
    enabled: options?.enabled ?? true,
  });
}

/** Everything a status change touches: cards, intro, journey line, section DTO. */
function useInvalidateQuizStatus() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['quizzes'] });
    qc.invalidateQueries({ queryKey: ['section'] });
    qc.invalidateQueries({ queryKey: ['certificates'] }); // «شهادة إتمام» quiz states
  };
}

export function useStartAttempt() {
  const invalidate = useInvalidateQuizStatus();
  return useMutation({
    mutationFn: (quizId: string) => startAttempt(quizId),
    onSuccess: invalidate,
  });
}

export function useSaveAnswer() {
  return useMutation({
    mutationFn: (vars: { attemptId: string; questionId: string; optionId: string }) =>
      saveAnswer(vars.attemptId, vars.questionId, vars.optionId),
  });
}

/** 0166: save one written answer (the solver debounces typing into this). */
export function useSaveTextAnswer() {
  return useMutation({
    mutationFn: (vars: { attemptId: string; questionId: string; text: string }) =>
      saveTextAnswer(vars.attemptId, vars.questionId, vars.text),
  });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  const invalidate = useInvalidateQuizStatus();
  return useMutation({
    mutationFn: (attemptId: string) => submitAttempt(attemptId),
    onSuccess: (result: QuizResult) => {
      qc.setQueryData(queryKeys.quizResult(result.attemptId), result);
      invalidate();
    },
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export function useAdminQuizzes() {
  return useQuery({
    queryKey: queryKeys.adminQuizzes,
    queryFn: adminListQuizzes,
  });
}

export function useAdminQuiz(quizId: string | null) {
  return useQuery({
    queryKey: queryKeys.adminQuiz(quizId ?? ''),
    queryFn: () => adminGetQuiz(quizId!),
    enabled: !!quizId,
  });
}

function useInvalidateAdminQuizzes() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin', 'quizzes'] });
    qc.invalidateQueries({ queryKey: ['admin', 'quiz'] });
    qc.invalidateQueries({ queryKey: ['quizzes'] });
    qc.invalidateQueries({ queryKey: ['section'] });
  };
}

export function useCreateQuiz() {
  const invalidate = useInvalidateAdminQuizzes();
  return useMutation({
    mutationFn: (vars: { input: QuizInput; questions: QuizQuestionInput[] }) =>
      createQuiz(vars.input, vars.questions),
    onSuccess: invalidate,
  });
}

export function useUpdateQuiz() {
  const invalidate = useInvalidateAdminQuizzes();
  return useMutation({
    mutationFn: (vars: { quizId: string; input: QuizInput; questions: QuizQuestionInput[] }) =>
      updateQuiz(vars.quizId, vars.input, vars.questions),
    onSuccess: invalidate,
  });
}

export function useDeleteQuiz() {
  const invalidate = useInvalidateAdminQuizzes();
  return useMutation({
    mutationFn: (quizId: string) => deleteQuiz(quizId),
    onSuccess: invalidate,
  });
}

export function useSetQuizStatus() {
  const invalidate = useInvalidateAdminQuizzes();
  return useMutation({
    mutationFn: (vars: { quizId: string; status: 'draft' | 'published' }) =>
      setQuizStatus(vars.quizId, vars.status),
    onSuccess: invalidate,
  });
}

/** Quick open/close a quiz's availability from the admin list. */
export function useSetQuizAvailability() {
  const invalidate = useInvalidateAdminQuizzes();
  return useMutation({
    mutationFn: (vars: { quizId: string; mode: 'open' | 'closed' }) =>
      setQuizAvailability(vars.quizId, vars.mode),
    onSuccess: invalidate,
  });
}

export function useQuizResultsSummary(quizId: string) {
  return useQuery({
    queryKey: [...queryKeys.adminQuizResults(quizId), 'summary'] as const,
    queryFn: () => getQuizResultsSummary(quizId),
    enabled: !!quizId,
  });
}

export function useQuizResultRows(quizId: string) {
  return useQuery({
    queryKey: [...queryKeys.adminQuizResults(quizId), 'rows'] as const,
    queryFn: () => listQuizResultRows(quizId),
    enabled: !!quizId,
  });
}

export function useAdminAttemptDetail(attemptId: string) {
  return useQuery({
    queryKey: queryKeys.adminQuizAttempt(attemptId),
    queryFn: () => getAttemptDetail(attemptId),
    enabled: !!attemptId,
  });
}

/** 0166 «بانتظار التصحيح» queue (admin · sheikh · publisher). */
export function usePendingGradings() {
  return useQuery({
    queryKey: queryKeys.adminPendingGradings,
    queryFn: listPendingGradings,
    staleTime: 60_000,
  });
}

/** 0166 «اعتماد التصحيح وإرسال النتيجة». */
export function useGradeAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { attemptId: string; grades: QuizWrittenGrade[] }) =>
      gradeAttempt(vars.attemptId, vars.grades),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.adminQuizAttempt(vars.attemptId) });
      qc.invalidateQueries({ queryKey: queryKeys.adminPendingGradings });
      qc.invalidateQueries({ queryKey: ['admin', 'quizResults'] });
    },
  });
}
