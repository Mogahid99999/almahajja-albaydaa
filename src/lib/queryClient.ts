import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client. Mounted once at the root via QueryClientProvider
 * in `app/_layout.tsx`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Lecture trees change rarely; keep data warm to avoid refetch churn.
      staleTime: 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
