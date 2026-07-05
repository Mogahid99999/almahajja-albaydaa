import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client. Mounted once at the root via QueryClientProvider
 * in `app/_layout.tsx`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Content trees change rarely; keep data warm so back-and-forth browsing is
      // instant and an offline cold start renders from the persisted cache (V10).
      staleTime: 30 * 60_000,
      // Survive well beyond a session so the async-storage persister (V10 Feature
      // D) has something to rehydrate on a cold offline launch.
      gcTime: 7 * 24 * 3600_000,
      // Serve cached data first and don't error a query just because we're
      // offline — downloaded content + browsed pages stay usable without a signal.
      networkMode: 'offlineFirst',
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
