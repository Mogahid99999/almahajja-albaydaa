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

/** Persist playback position; invalidates the affected progress/section/home views. */
export function useSaveProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveLectureProgress,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.lectureProgress(vars.lectureId) });
      qc.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
