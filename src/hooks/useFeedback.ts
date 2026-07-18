import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminCloseTicket,
  adminDeleteFeedback,
  adminListFeedback,
  adminReplyTicket,
  adminSetFeedbackStatus,
  getMyTickets,
  getTicketThread,
  studentReplyTicket,
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

// ─── Support tickets (item 10) ────────────────────────────────────────────────

/** The signed-in student's own tickets. Fresh on open so status/last-reply is current. */
export function useMyTickets(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myTickets,
    queryFn: getMyTickets,
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * The message thread of one ticket (owner or admin). Always refetched on open:
 * the persisted offline-first cache would otherwise serve a stale thread (e.g.
 * only the student's own opening message) so the student never saw the admin's
 * reply until a restart. staleTime 0 + refetchOnMount 'always' means opening the
 * ticket always pulls the latest conversation.
 */
export function useTicketThread(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ticketThread(id),
    queryFn: () => getTicketThread(id),
    enabled: enabled && !!id,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

function useInvalidateTicket(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.ticketThread(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.myTickets });
    void qc.invalidateQueries({ queryKey: FEEDBACK_ROOT });
  };
}

/** Student appends a reply to their own ticket. */
export function useStudentReplyTicket(feedbackId: string) {
  const invalidate = useInvalidateTicket(feedbackId);
  return useMutation({
    mutationFn: (body: string) => studentReplyTicket(feedbackId, body),
    onSuccess: invalidate,
  });
}

/** Admin reply with optional image + CTA. */
export function useAdminReplyTicket(feedbackId: string) {
  const invalidate = useInvalidateTicket(feedbackId);
  return useMutation({
    mutationFn: (vars: {
      body: string;
      imagePath?: string | null;
      ctaLabel?: string | null;
      ctaRoute?: string | null;
    }) =>
      adminReplyTicket(feedbackId, vars.body, {
        imagePath: vars.imagePath,
        ctaLabel: vars.ctaLabel,
        ctaRoute: vars.ctaRoute,
      }),
    onSuccess: invalidate,
  });
}

/** Admin closes a ticket. */
export function useAdminCloseTicket(feedbackId: string) {
  const invalidate = useInvalidateTicket(feedbackId);
  return useMutation({
    mutationFn: () => adminCloseTicket(feedbackId),
    onSuccess: invalidate,
  });
}
