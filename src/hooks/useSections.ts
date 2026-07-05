import { useCallback } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { getHomeData, getSectionPage, getSectionsFlat } from '@/api/sections';
import { queryKeys } from '@/constants/queryKeys';

/** Home screen data (resume + newly added + sections grid). */
export function useHome() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: getHomeData,
    placeholderData: keepPreviousData,
  });
}

/**
 * Section tree node + its rollup. Inherits the 30-min staleTime default so
 * back-and-forth browsing never refetches; keepPreviousData holds the prior
 * section's data on screen while the next loads, so navigation shows content
 * immediately instead of a spinner (V10 Perf C).
 */
export function useSectionPage(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.section(sectionId),
    queryFn: () => getSectionPage(sectionId),
    enabled: !!sectionId,
    placeholderData: keepPreviousData,
  });
}

/**
 * Warm a section page BEFORE it's tapped (V10 Perf C). Section cards call this on
 * mount so the target page is already in cache by the time the user taps it — the
 * open is then instant with no spinner. A no-op when the page is still fresh
 * (staleTime), so re-renders don't re-fetch.
 */
export function usePrefetchSection() {
  const qc = useQueryClient();
  return useCallback(
    (sectionId: string) => {
      if (!sectionId) return;
      void qc.prefetchQuery({
        queryKey: queryKeys.section(sectionId),
        queryFn: () => getSectionPage(sectionId),
        staleTime: 30 * 60_000,
      });
    },
    [qc],
  );
}

/** Admin parent-section picker. */
export function useSectionsFlat() {
  return useQuery({
    queryKey: queryKeys.sectionsFlat,
    queryFn: getSectionsFlat,
  });
}
