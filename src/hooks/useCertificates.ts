import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  getCertificateEligibility,
  getCertificateFiles,
  getMyCertificate,
  getMyCertificates,
  getSectionCertificateSettings,
  saveSectionCertificateSettings,
  type SaveSectionCertificateInput,
} from '@/api/certificates';
import { queryKeys } from '@/constants/queryKeys';
import { useCurrentUser } from '@/hooks/useAuth';

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

/**
 * «شهاداتي» (0169): the student's certificate sections, each with its
 * certificate_eligibility. Shared by the screen and the «شهادة إتمام» marks, so
 * one cached call serves every section card. Needs a session (guests have one).
 */
export function useMyCertificates(options?: { enabled?: boolean; refetchOnMount?: boolean | 'always' }) {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.myCertificates,
    queryFn: getMyCertificates,
    enabled: (options?.enabled ?? true) && !!user,
    staleTime: 5 * 60_000,
    refetchOnMount: options?.refetchOnMount ?? true,
  });
}

/**
 * Ids of the section CARDS that carry the «شهادة إتمام» mark: the sections that
 * grant a certificate and every section above them, so a main section with no
 * certificate of its own still shows that one waits inside.
 */
export function useCertificateCardIds(): Set<string> {
  const { data } = useMyCertificates();
  return useMemo(() => new Set((data ?? []).flatMap((c) => [c.sectionId, ...c.ancestorIds])), [data]);
}

/** Ids of the sections that themselves grant this student a certificate (section page). */
export function useCertificateSectionIds(): Set<string> {
  const { data } = useMyCertificates();
  return useMemo(() => new Set((data ?? []).map((c) => c.sectionId)), [data]);
}

/** One issued certificate. Polls briefly while the server is still rendering its PDF. */
export function useMyCertificate(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.myCertificate(id ?? ''),
    queryFn: () => getMyCertificate(id ?? ''),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && !q.state.data.ready && q.state.data.status === 'valid' ? 4000 : false),
  });
}

/** Signed links last five minutes, so they are refetched well before that. */
export function useCertificateFiles(id: string | undefined, ready: boolean) {
  return useQuery({
    queryKey: queryKeys.certificateFiles(id ?? ''),
    queryFn: () => getCertificateFiles(id ?? ''),
    enabled: !!id && ready,
    staleTime: 3 * 60_000,
    gcTime: 4 * 60_000,
  });
}
