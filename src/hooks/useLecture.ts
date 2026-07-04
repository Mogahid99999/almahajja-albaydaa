import { useQuery } from '@tanstack/react-query';

import { getFeaturedLectures, getLecturePlayback, getLecturesByIds, getRecentLectures } from '@/api/lectures';
import { queryKeys } from '@/constants/queryKeys';

/**
 * Full playback metadata for one lecture (player), incl. a signed audio URL
 * valid 3600s — cache it near that long (45min stale / 50min gc) so
 * reopening the same lecture within that window never re-mints the URL.
 */
export function useLecturePlayback(lectureId: string) {
  return useQuery({
    queryKey: queryKeys.lecture(lectureId),
    queryFn: () => getLecturePlayback(lectureId),
    enabled: !!lectureId,
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
  });
}

/** Lecture cards for a set of ids (downloads page). */
export function useLecturesByIds(ids: string[]) {
  return useQuery({
    queryKey: queryKeys.lecturesByIds(ids),
    queryFn: () => getLecturesByIds(ids),
    enabled: ids.length > 0,
  });
}

/** Newly-added published lectures, newest first (أحدث الدروس screen). */
export function useRecentLectures() {
  return useQuery({
    queryKey: queryKeys.recentLectures,
    queryFn: () => getRecentLectures(),
  });
}

/** The curated «المختارات» list (full-list screen). Changes rarely (staff-curated). */
export function useFeaturedLectures() {
  return useQuery({
    queryKey: queryKeys.featuredLectures,
    queryFn: () => getFeaturedLectures(),
    staleTime: 5 * 60_000,
  });
}
