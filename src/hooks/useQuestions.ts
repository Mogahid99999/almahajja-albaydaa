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
  updateOwnQuestion,
  type InboxQuestion,
  type QuestionAudience,
  type QuestionCategory,
  type QuestionScope,
  type QuestionStatus,
} from '@/api/questions';
import { queryKeys } from '@/constants/queryKeys';

const QUESTION_INBOX_ROOT = ['questions', 'inbox'] as const;

export function usePublicQuestions(
  scope: QuestionScope,
  lectureId?: string,
  category?: QuestionCategory,
) {
  return useQuery({
    queryKey: queryKeys.publicQuestions(scope, lectureId, category),
    queryFn: () => getPublicQuestions(scope, lectureId, category),
    enabled: scope === 'general' || !!lectureId,
  });
}

export function useMyQuestions(
  scope: QuestionScope,
  lectureId?: string,
  enabled = true,
  category?: QuestionCategory,
) {
  return useQuery({
    queryKey: queryKeys.myQuestions(scope, lectureId, category),
    queryFn: () => getMyQuestions(scope, lectureId, category),
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
      category: QuestionCategory;
    }) => askQuestion(input),
    onSuccess: (_id, vars) => {
      void qc.invalidateQueries({ queryKey: ['questions', 'mine', vars.scope] });
    },
  });
}

/**
 * The asker edits their own question (body / privacy / category). Invalidates
 * both the my-questions and public-questions caches — a changed body pulls an
 * answered question back to pending, which also removes it from the public list.
 */
export function useUpdateOwnQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      body: string;
      audience: QuestionAudience;
      category: QuestionCategory;
    }) => updateOwnQuestion(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['questions', 'public'] });
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
  category?: QuestionCategory;
}) {
  return useQuery({
    queryKey: queryKeys.questionInbox(filter.scope, filter.status, filter.category),
    queryFn: () => getQuestionInbox(filter),
  });
}

export function useSetQuestionHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { questionId: string; hidden: boolean }) =>
      setQuestionHidden(vars.questionId, vars.hidden),
    // Optimistic: flip the inbox row's status the instant إخفاء/إظهار is
    // tapped (mirrors set_question_hidden's status logic, migration 0032), so
    // the action never looks like a dead button on a slow link.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUESTION_INBOX_ROOT });
      const snapshots = qc.getQueriesData<InboxQuestion[]>({ queryKey: QUESTION_INBOX_ROOT });
      qc.setQueriesData<InboxQuestion[]>({ queryKey: QUESTION_INBOX_ROOT }, (rows) =>
        rows?.map((r) => {
          if (r.id !== vars.questionId) return r;
          const status: QuestionStatus = vars.hidden
            ? 'hidden'
            : r.answerBody && r.answerBody.trim().length > 0
              ? 'answered'
              : 'pending';
          return { ...r, status };
        }),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
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
    onMutate: async (questionId) => {
      await qc.cancelQueries({ queryKey: QUESTION_INBOX_ROOT });
      const snapshots = qc.getQueriesData<InboxQuestion[]>({ queryKey: QUESTION_INBOX_ROOT });
      qc.setQueriesData<InboxQuestion[]>({ queryKey: QUESTION_INBOX_ROOT }, (rows) =>
        rows?.filter((r) => r.id !== questionId),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });
}
