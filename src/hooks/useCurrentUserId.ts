import { useSyncExternalStore } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { queryClient } from '@/lib/queryClient';

const subscribe = (notify: () => void) => queryClient.getQueryCache().subscribe(notify);
const read = () => queryClient.getQueryData<{ id: string } | null>(queryKeys.currentUser)?.id;

/**
 * The signed-in account id, read from the cache itself. Sign-in calls
 * `qc.clear()`, which leaves an already mounted useQuery observer on the removed
 * query, so a component that does not re-render keeps seeing the old account.
 */
export function useCurrentUserId(): string | undefined {
  return useSyncExternalStore(subscribe, read, read);
}
