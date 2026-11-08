import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCertificateEligibility,
  getSectionCertificateSettings,
  saveSectionCertificateSettings,
  type SaveSectionCertificateInput,
} from '@/api/certificates';
import { queryKeys } from '@/constants/queryKeys';

/** The section's certificate settings + its subtree quizzes (admin section editor). */
export function useSectionCertificateSettings(sectionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sectionCertificate(sectionId ?? ''),
    queryFn: () => getSectionCertificateSettings(sectionId ?? ''),
    enabled: !!sectionId,
  });
}

export function useSaveSectionCertificateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSectionCertificateInput) => saveSectionCertificateSettings(input),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.sectionCertificate(input.sectionId) });
      qc.invalidateQueries({ queryKey: ['certificates', 'eligibility', input.sectionId] });
    },
  });
}

/**
 * Central eligibility for a section certificate (0168 certificate_eligibility).
 * Not wired to a screen yet — the issuing step and the student's progress view
 * (next phase) build on it. `userId` omitted = the signed-in user.
 */
export function useCertificateEligibility(
  sectionId: string | undefined,
  options?: { userId?: string; enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.certificateEligibility(sectionId ?? '', options?.userId),
    queryFn: () => getCertificateEligibility(sectionId ?? '', options?.userId),
    enabled: (options?.enabled ?? true) && !!sectionId,
    staleTime: 30_000,
  });
}
