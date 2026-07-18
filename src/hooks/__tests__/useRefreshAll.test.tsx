/**
 * Regression for the pull-to-refresh fix: useRefreshAll must invalidate EVERY
 * cached query (no key filter) and refetch even unmounted ones (refetchType
 * 'all') — otherwise shared app-config (the support link, About/Q&A/share copy)
 * keeps serving its 30-min-stale cache after an admin edit until a full restart.
 *
 * Rendered through a real component (this repo's tests use `render`, not
 * `renderHook`) so the hook runs inside a QueryClientProvider exactly as it does
 * in the app.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { useRefreshAll } from '@/hooks/useRefreshAll';

function Harness({ onReady }: { onReady: (fn: () => Promise<void>) => void }) {
  const refreshAll = useRefreshAll();
  useEffect(() => {
    onReady(refreshAll);
  }, [refreshAll, onReady]);
  return <Text>ready</Text>;
}

describe('useRefreshAll', () => {
  it('invalidates ALL queries and refetches even unmounted ones', async () => {
    const client = new QueryClient();
    const spy = jest.spyOn(client, 'invalidateQueries').mockResolvedValue();

    let refreshAll: (() => Promise<void>) | undefined;
    await render(
      <QueryClientProvider client={client}>
        <Harness onReady={(fn) => (refreshAll = fn)} />
      </QueryClientProvider>,
    );

    await refreshAll!();

    // No filter object with a queryKey → every query matches — and refetchType
    // 'all' so a stale support-link query on another tab still refetches.
    expect(spy).toHaveBeenCalledWith({ refetchType: 'all' });
  });
});
