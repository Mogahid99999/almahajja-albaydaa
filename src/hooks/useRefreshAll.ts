import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * One pull-to-refresh that refreshes EVERYTHING the server can change — not just
 * the current screen's own queries.
 *
 * The bug this fixes: every screen used to pull-to-refresh only a hand-picked
 * subset of query keys (Home refreshed buddy/notifications/journey/broadcasts;
 * others just their one query). Shared/app-config values — the support link,
 * About copy, Q&A notice, share link, «ابدأ من هنا», and anything else editable
 * from the admin panel — were NEVER in any screen's list, and they carry a long
 * staleTime (30 min), so a change made in the admin panel only appeared after a
 * full app restart. Pull-to-refresh is an explicit user action, so it should
 * mean "get me the latest of everything", exactly like a cold launch does.
 *
 * Implementation: `invalidateQueries` with NO key matches every cached query,
 * and `refetchType: 'all'` refetches even the ones whose component isn't
 * currently mounted (e.g. the support link, About page, a buddy card on another
 * tab) — so nothing is left serving stale cache. Returns a promise that settles
 * when the active refetches finish, so the caller's spinner times correctly.
 *
 * Use it via {@link usePullToRefresh} (pass `refreshAll` as one of the fns), or
 * call the returned function directly.
 */
export function useRefreshAll(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(
    () => qc.invalidateQueries({ refetchType: 'all' }),
    [qc],
  );
}
