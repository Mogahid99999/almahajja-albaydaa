import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addLectureBenefit,
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
      void qc.invalidateQueries({ queryKey: queryKeys.lectureBenefits(lectureId) });
    },
  });
}

export function useDeleteOwnBenefit(lectureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (benefitId: string) => deleteOwnBenefit(benefitId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.lectureBenefits(lectureId) });
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
