import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  answerQuestion,
  askQuestion,
  deleteOwnQuestion,
  deleteQuestion,
  getMyQuestions,
  getPublicQuestions,
  getQuestionInbox,
  setQuestionHidden,
  type QuestionAudience,
  type QuestionScope,
  type QuestionStatus,
} from '@/api/questions';
import { queryKeys } from '@/constants/queryKeys';

export function usePublicQuestions(scope: QuestionScope, lectureId?: string) {
  return useQuery({
    queryKey: queryKeys.publicQuestions(scope, lectureId),
    queryFn: () => getPublicQuestions(scope, lectureId),
    enabled: scope === 'general' || !!lectureId,
  });
}

export function useMyQuestions(scope: QuestionScope, lectureId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.myQuestions(scope, lectureId),
    queryFn: () => getMyQuestions(scope, lectureId),
    enabled: enabled && (scope === 'general' || !!lectureId),
  });
}

export function useAskQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: QuestionScope;
      lectureId?: string;
      isAnonymous: boolean;
      audience: QuestionAudience;
      body: string;
    }) => askQuestion(input),
    onSuccess: (_id, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.myQuestions(vars.scope, vars.lectureId) });
    },
  });
}

/** The asker deletes their own question. */
export function useDeleteOwnQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) => deleteOwnQuestion(questionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });
}

// ─── Moderator (sheikh + admin) ───────────────────────────────────────────────

export function useQuestionInbox(filter: {
  scope?: QuestionScope;
  status?: QuestionStatus;
}) {
  return useQuery({
    queryKey: queryKeys.questionInbox(filter.scope, filter.status),
    queryFn: () => getQuestionInbox(filter),
  });
}

export function useSetQuestionHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { questionId: string; hidden: boolean }) =>
      setQuestionHidden(vars.questionId, vars.hidden),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });
}

export function useAnswerQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { questionId: string; answerBody: string }) =>
      answerQuestion(vars.questionId, vars.answerBody),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });
}

export function useDeleteQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) => deleteQuestion(questionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });
}
