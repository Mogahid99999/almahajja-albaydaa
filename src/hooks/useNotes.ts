import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMyNote, saveMyNote, type LectureNote } from '@/api/notes';
import { queryKeys } from '@/constants/queryKeys';

export function useLectureNote(lectureId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.lectureNote(lectureId),
    queryFn: () => getMyNote(lectureId),
    enabled: enabled && !!lectureId,
  });
}

export function useSaveNote(lectureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => saveMyNote(lectureId, body),
    onSuccess: (_r, body) => {
      qc.setQueryData(
        queryKeys.lectureNote(lectureId),
        (): LectureNote => ({ body, updatedAt: new Date().toISOString() }),
      );
    },
  });
}
