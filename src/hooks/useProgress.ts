import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getLectureProgress, saveLectureProgress } from '@/api/progress';
import { queryKeys } from '@/constants/queryKeys';

/** Resume info for a single lecture. */
export function useLectureProgress(lectureId: string) {
  return useQuery({
    queryKey: queryKeys.lectureProgress(lectureId),
    queryFn: () => getLectureProgress(lectureId),
    enabled: !!lectureId,
  });
}

/** Persist playback position; invalidates progress/home + the journey rollups. */
export function useSaveProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveLectureProgress,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.lectureProgress(vars.lectureId) });
      qc.invalidateQueries({ queryKey: queryKeys.home });
      // The same save feeds daily_listening + badge evaluation (رحلتي العلمية).
      qc.invalidateQueries({ queryKey: queryKeys.journey });
      qc.invalidateQueries({ queryKey: queryKeys.badges });
      // ...and may flip today's streak state (26.1) — refresh the home card.
      qc.invalidateQueries({ queryKey: queryKeys.streak });
    },
  });
}
