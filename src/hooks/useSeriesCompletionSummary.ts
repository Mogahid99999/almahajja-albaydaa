import { useQuery } from '@tanstack/react-query';

import { getSeriesBenefits, getSeriesCompletionSummary } from '@/api/seriesSummary';
import { queryKeys } from '@/constants/queryKeys';

/**
 * «ملخص إتمام السلسلة» summary for one series subtree (V20 · Feature A). Reads
 * through the persisted query cache so the closing page opens instantly offline;
 * off for guests / when no section id. (The seal ribbons derive completeness from
 * the section-page rollup they already have — they don't call this.)
 */
export function useSeriesCompletionSummary(
  sectionId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.seriesSummary(sectionId ?? ''),
    queryFn: () => getSeriesCompletionSummary(sectionId ?? ''),
    enabled: (options?.enabled ?? true) && !!sectionId,
    staleTime: 60_000,
  });
}

/** All shared فوائد in a series, for the «مراجعة الفوائد» review page (Feature A). */
export function useSeriesBenefits(sectionId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.seriesBenefits(sectionId ?? ''),
    queryFn: () => getSeriesBenefits(sectionId ?? ''),
    enabled: (options?.enabled ?? true) && !!sectionId,
    staleTime: 60_000,
  });
}
