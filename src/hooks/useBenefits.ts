import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addGeneralBenefit,
  addLectureBenefit,
  getBenefitsFeed,
  type BenefitFeedKind,
  adminDeleteBenefit,
  adminListBenefits,
  adminSetBenefitStatus,
  deleteOwnBenefit,
  getLectureBenefits,
  type AdminBenefitRow,
  type BenefitStatus,
} from '@/api/benefits';
import { queryKeys } from '@/constants/queryKeys';

const ADMIN_BENEFITS_ROOT = ['admin', 'benefits'] as const;
const BENEFITS_PAGE = 40;

export function useLectureBenefits(lectureId: string) {
  return useQuery({
    queryKey: queryKeys.lectureBenefits(lectureId),
    queryFn: () => getLectureBenefits(lectureId),
    enabled: !!lectureId,
  });
}

export function useAddBenefit(lectureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addLectureBenefit(lectureId, body),
    onSuccess: () => {
      // The ['benefits'] root covers this lesson's list AND the unified feed.
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}

export function useDeleteOwnBenefit(lectureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (benefitId: string) => deleteOwnBenefit(benefitId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}

// ─── فوائد الدارسين — the unified feed (0161) ───────────────────────────────────

/** Newest first, paged by created_at: الكل / من المحاضرات / فوائد عامة / فوائدي. */
export function useBenefitsFeed(kind: BenefitFeedKind, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.benefitsFeed(kind),
    queryFn: ({ pageParam }) => getBenefitsFeed(kind, pageParam, BENEFITS_PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length >= BENEFITS_PAGE ? last[last.length - 1].createdAt : undefined,
    enabled,
  });
}

/** Post a benefit — from a lesson (lectureId) or a general one (null). */
export function usePostBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lectureId: string | null; body: string }) =>
      vars.lectureId ? addLectureBenefit(vars.lectureId, vars.body) : addGeneralBenefit(vars.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}

/** Delete one of my benefits from the feed (no lesson context needed). */
export function useDeleteMyBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (benefitId: string) => deleteOwnBenefit(benefitId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}

// ─── Admin moderation ─────────────────────────────────────────────────────────

export function useAdminBenefits(lectureId?: string) {
  return useQuery({
    queryKey: queryKeys.adminBenefits(lectureId),
    queryFn: () => adminListBenefits(lectureId),
  });
}

export function useAdminSetBenefitStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { benefitId: string; status: BenefitStatus }) =>
      adminSetBenefitStatus(vars.benefitId, vars.status),
    // Optimistic: flip the badge/label the instant إخفاء/إظهار is tapped —
    // the server round-trip then just confirms (or rolls back on error).
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ADMIN_BENEFITS_ROOT });
      const snapshots = qc.getQueriesData<AdminBenefitRow[]>({ queryKey: ADMIN_BENEFITS_ROOT });
      qc.setQueriesData<AdminBenefitRow[]>({ queryKey: ADMIN_BENEFITS_ROOT }, (rows) =>
        rows?.map((r) => (r.id === vars.benefitId ? { ...r, status: vars.status } : r)),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ADMIN_BENEFITS_ROOT });
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}

export function useAdminDeleteBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (benefitId: string) => adminDeleteBenefit(benefitId),
    onMutate: async (benefitId) => {
      await qc.cancelQueries({ queryKey: ADMIN_BENEFITS_ROOT });
      const snapshots = qc.getQueriesData<AdminBenefitRow[]>({ queryKey: ADMIN_BENEFITS_ROOT });
      qc.setQueriesData<AdminBenefitRow[]>({ queryKey: ADMIN_BENEFITS_ROOT }, (rows) =>
        rows?.filter((r) => r.id !== benefitId),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ADMIN_BENEFITS_ROOT });
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}
