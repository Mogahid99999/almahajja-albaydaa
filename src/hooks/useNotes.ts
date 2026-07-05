import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMyNote, saveMyNote, type LectureNote } from '@/api/notes';
import { queryKeys } from '@/constants/queryKeys';
import { enqueueNote } from '@/lib/outbox';

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
    // offlineFirst so the mutationFn RUNS even offline (default 'online' would
    // PAUSE it, so onError never fires and a force-stop would drop the edit).
    // Offline it fails fast → onError queues it durably in the outbox.
    networkMode: 'offlineFirst',
    mutationFn: (body: string) => saveMyNote(lectureId, body),
    // Optimistic (offline-first): reflect the new body immediately. The notes
    // query is persisted, so it survives a force-stop even before the server
    // confirms — the editor renders the latest text on a cold offline relaunch.
    onMutate: (body) => {
      qc.setQueryData(
        queryKeys.lectureNote(lectureId),
        (): LectureNote => ({ body, updatedAt: new Date().toISOString() }),
      );
    },
    // Offline / failed write → queue for replay on reconnect (last-write-wins).
    // The editor surfaces the calm «سيُحفظ عند عودة الاتصال» state from isError.
    onError: (_e, body) => {
      void enqueueNote(lectureId, body);
    },
  });
}
