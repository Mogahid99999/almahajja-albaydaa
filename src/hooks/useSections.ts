import { useQuery } from '@tanstack/react-query';

import { getHomeData, getSectionPage, getSectionsFlat } from '@/api/sections';
import { queryKeys } from '@/constants/queryKeys';

/** Home screen data (resume + newly added + sections grid). */
export function useHome() {
  return useQuery({ queryKey: queryKeys.home, queryFn: getHomeData });
}

export function useSectionPage(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.section(sectionId),
    queryFn: () => getSectionPage(sectionId),
    enabled: !!sectionId,
  });
}

/** Admin parent-section picker. */
export function useSectionsFlat() {
  return useQuery({
    queryKey: queryKeys.sectionsFlat,
    queryFn: getSectionsFlat,
  });
}
