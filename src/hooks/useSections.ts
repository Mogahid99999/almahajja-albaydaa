import { useQuery } from '@tanstack/react-query';

import { getHomeData, getSectionPage, getSectionsFlat } from '@/api/sections';
import { queryKeys } from '@/constants/queryKeys';

/** Home screen data (resume + newly added + sections grid). */
export function useHome() {
  return useQuery({ queryKey: queryKeys.home, queryFn: getHomeData });
}

/** Section tree node + its rollup — changes rarely; 5min keeps back-and-forth browsing quiet. */
export function useSectionPage(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.section(sectionId),
    queryFn: () => getSectionPage(sectionId),
    enabled: !!sectionId,
    staleTime: 5 * 60_000,
  });
}

/** Admin parent-section picker. */
export function useSectionsFlat() {
  return useQuery({
    queryKey: queryKeys.sectionsFlat,
    queryFn: getSectionsFlat,
  });
}
