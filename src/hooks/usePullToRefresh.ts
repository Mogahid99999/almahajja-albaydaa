import { useCallback, useState } from 'react';

/**
 * Combines N independent query refetches into one pull-to-refresh gesture.
 * Uses allSettled so one hook's rejection can't leave the spinner stuck or
 * block the others from refreshing.
 */
export function usePullToRefresh(refetchFns: Array<() => Promise<unknown>>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.allSettled(refetchFns.map((fn) => fn())).finally(() => {
      setRefreshing(false);
    });
  }, [refreshing, refetchFns]);

  return { refreshing, onRefresh };
}
