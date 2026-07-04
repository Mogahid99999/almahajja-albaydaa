import { useQuery } from '@tanstack/react-query';

import { getFeaturedLectures, getLecturePlayback, getLecturesByIds, getRecentLectures } from '@/api/lectures';
import { queryKeys } from '@/constants/queryKeys';

/** Full playback metadata for one lecture (player). */
export function useLecturePlayback(lectureId: string) {
  return useQuery({
    queryKey: queryKeys.lecture(lectureId),
    queryFn: () => getLecturePlayback(lectureId),
    enabled: !!lectureId,
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

/** The curated «المختارات» list (full-list screen). */
export function useFeaturedLectures() {
  return useQuery({
    queryKey: queryKeys.featuredLectures,
    queryFn: () => getFeaturedLectures(),
  });
}
