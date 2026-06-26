import { useQuery } from '@tanstack/react-query';

import { getLecturePlayback, getLecturesByIds } from '@/api/lectures';
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
