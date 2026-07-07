import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminDeleteFeedback,
  adminListFeedback,
  adminSetFeedbackStatus,
  submitFeedback,
  type AdminFeedbackRow,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@/api/feedback';
import { queryKeys } from '@/constants/queryKeys';

const FEEDBACK_ROOT = ['admin', 'feedback'] as const;

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (vars: { category: FeedbackCategory; message: string }) =>
      submitFeedback(vars.category, vars.message),
  });
}

// ─── Admin triage ───────────────────────────────────────────────────────────

export function useAdminFeedback(status?: FeedbackStatus, enabled = true) {
  return useQuery({
    queryKey: queryKeys.feedback(status),
    queryFn: () => adminListFeedback(status),
    enabled,
  });
}

export function useAdminSetFeedbackStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { feedbackId: string; status: FeedbackStatus; adminNote?: string }) =>
      adminSetFeedbackStatus(vars.feedbackId, vars.status, vars.adminNote),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: FEEDBACK_ROOT });
      const snapshots = qc.getQueriesData<AdminFeedbackRow[]>({ queryKey: FEEDBACK_ROOT });
      qc.setQueriesData<AdminFeedbackRow[]>({ queryKey: FEEDBACK_ROOT }, (rows) =>
        rows?.map((r) => (r.id === vars.feedbackId ? { ...r, status: vars.status } : r)),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: FEEDBACK_ROOT });
    },
  });
}

export function useAdminDeleteFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackId: string) => adminDeleteFeedback(feedbackId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FEEDBACK_ROOT });
    },
  });
}
