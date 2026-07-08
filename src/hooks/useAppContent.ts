import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAboutContent, getAppConfigForAdmin, getQnaNotice, getShareContent, getSupportContact, setAppConfig } from '@/api/appContent';
import { queryKeys } from '@/constants/queryKeys';

/** Student-facing About content (falls back to the original copy). Rarely edited. */
export function useAboutContent() {
  return useQuery({
    queryKey: queryKeys.aboutContent,
    queryFn: getAboutContent,
    staleTime: 30 * 60_000,
  });
}

/** WhatsApp support link for the sign-in screen (empty = hidden). Rarely edited. */
export function useSupportContact() {
  return useQuery({
    queryKey: queryKeys.supportContact,
    queryFn: getSupportContact,
    staleTime: 30 * 60_000,
  });
}

/** Q&A notice above the questions boards (empty rarely, falls back to default copy). */
export function useQnaNotice() {
  return useQuery({
    queryKey: queryKeys.qnaNotice,
    queryFn: getQnaNotice,
    staleTime: 30 * 60_000,
  });
}

/** Share-the-app link + phrase (falls back to a hardcoded default). Rarely edited. */
export function useShareContent() {
  return useQuery({
    queryKey: queryKeys.shareContent,
    queryFn: getShareContent,
    staleTime: 30 * 60_000,
  });
}

/** Admin Settings — all editable config keys. */
export function useAdminConfig() {
  return useQuery({
    queryKey: queryKeys.adminConfig,
    queryFn: getAppConfigForAdmin,
    staleTime: 30_000,
  });
}

/** Save one config key; refreshes both the admin form and the student About. */
export function useSetAppConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; value: string }) => setAppConfig(vars.key, vars.value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminConfig });
      qc.invalidateQueries({ queryKey: queryKeys.aboutContent });
      qc.invalidateQueries({ queryKey: queryKeys.supportContact });
      qc.invalidateQueries({ queryKey: queryKeys.shareContent });
    },
  });
}
