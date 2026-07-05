import { useQuery } from '@tanstack/react-query';

import { getAdminDashboardStats } from '@/api/adminStats';
import { getAdminProgressAnalytics } from '@/api/adminAnalytics';
import { queryKeys } from '@/constants/queryKeys';

/**
 * Feature 2 — dashboard overview tiles + top lists.
 * `enabled` defaults to true; the dashboard screen passes `role === 'admin'`
 * so a ناشر (publisher) — who gets bounced to /admin/lectures by
 * `useAdminOnly` — never fires this admin-only RPC in the split second before
 * that redirect lands (RLS already denies it; this just skips the wasted call).
 */
export function useAdminStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: getAdminDashboardStats,
    staleTime: 60_000,
    enabled,
  });
}

/** Feature 3 — progress analytics (aggregate + admin-private lists). */
export function useAdminAnalytics() {
  return useQuery({
    queryKey: queryKeys.adminAnalytics,
    queryFn: getAdminProgressAnalytics,
    staleTime: 60_000,
  });
}
