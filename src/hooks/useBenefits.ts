import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addLectureBenefit,
  adminDeleteBenefit,
  adminListBenefits,
  adminSetBenefitStatus,
  deleteOwnBenefit,
  getLectureBenefits,
  type BenefitStatus,
} from '@/api/benefits';
import { queryKeys } from '@/constants/queryKeys';

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'benefits'] });
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}

export function useAdminDeleteBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (benefitId: string) => adminDeleteBenefit(benefitId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'benefits'] });
      void qc.invalidateQueries({ queryKey: ['benefits'] });
    },
  });
}
