import { QueryClient } from '@tanstack/react-query';

import { isOnlineSync } from '@/lib/connectivity';

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

/**
 * Query-key roots that hold "admin can add/remove/unpublish" content lists:
 * Home rails + resume, section lecture lists, the sections grid, and
 * recent/featured/by-ids lecture-card lists. These must reconcile with the
 * server shortly after a cold launch — otherwise the persisted cache can keep
 * showing deleted/unpublished content for up to a full `staleTime` (30 min),
 * across any number of force-stop/relaunch cycles within that window, because
 * `PersistQueryClientProvider` restores the ORIGINAL pre-restart
 * `dataUpdatedAt` and React Query only refetches-on-mount when a query is
 * stale or invalidated (Phase 3.4).
 *
 * Deliberately excludes:
 * - `'lecture'` (singular) — single-lecture playback metadata + signed URL,
 *   staled/invalidated on its own schedule elsewhere (audioController.ts /
 *   useLecture.ts). Do not add it here.
 * - Private/volatile roots (`'notes'`, `'journey'`, `'benefits'`,
 *   `'notifications'`, `'quizzes'`, `'admin'`, ...) — out of scope for this fix.
 */
const RECONCILE_ON_LAUNCH_ROOTS = new Set<string>(['home', 'section', 'sections', 'lectures']);

/**
 * Fired once, right after the persisted query cache finishes restoring from disk
 * (wired to `onSuccess` on `PersistQueryClientProvider` in `app/_layout.tsx`).
 * Forces a background reconciliation of the content-list roots above so a cold
 * relaunch converges on the server's current data within that same relaunch,
 * instead of silently trusting a persisted `dataUpdatedAt` for up to 30 minutes
 * of real time.
 *
 * - Only runs when online (`isOnlineSync`): an offline cold launch must still
 *   render instantly from the persisted cache with zero network attempts.
 * - Scoped with `refetchType: 'active'` so only mounted/about-to-mount queries
 *   actually refetch — this reconciles the visible screen without turning into
 *   a blanket "refetch the whole persisted cache on every launch," which would
 *   defeat the point of the persisted-cache offline-first design (V10
 *   Feature D).
 * - Runs after hydration has already populated the cache (and the first paint
 *   has already used it), so this never blocks or delays first render.
 */
export function reconcileContentListsAfterHydration(): void {
  if (!isOnlineSync()) return;
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === 'string' && RECONCILE_ON_LAUNCH_ROOTS.has(root);
    },
    refetchType: 'active',
  });
}
