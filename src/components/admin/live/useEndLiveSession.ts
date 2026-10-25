/**
 * «إنهاء البث للجميع» from the staff «البث المباشر» screen (owner 2026-09-29:
 * «احاول انهاء البث ولا يقفل معي» — a live card had no way to end it, e.g. a
 * live whose host had already left the room). live-control `end` through
 * src/api/liveAdmin.ts endLiveSession; the staff lists, Home's «مباشر الآن»
 * and the session itself refresh either way. Variables = the session id.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { endLiveSession } from '@/api/liveAdmin';
import { queryKeys } from '@/constants/queryKeys';
import { useRefreshLiveAdmin } from '@/hooks/useLiveAdmin';
import { endedHere } from '@/stores/liveStore';

export function useEndLiveSession() {
  const qc = useQueryClient();
  const refresh = useRefreshLiveAdmin();
  return useMutation({
    mutationFn: endLiveSession,
    networkMode: 'always',
    // This phone's own room (open, minimised, or still joining) ends at once —
    // it never waits for ROOM_DELETED or the room's next session poll.
    onSuccess: (_d, sessionId) => endedHere(sessionId),
    onSettled: (_d, _e, sessionId) => {
      refresh();
      void qc.invalidateQueries({ queryKey: queryKeys.liveSession(sessionId) });
    },
  });
}
