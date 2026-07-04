import { useQuery } from '@tanstack/react-query';

import { getAdminDashboardStats } from '@/api/adminStats';
import { getAdminProgressAnalytics } from '@/api/adminAnalytics';
import { queryKeys } from '@/constants/queryKeys';

/** Feature 2 — dashboard overview tiles + top lists. */
export function useAdminStats() {
  return useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: getAdminDashboardStats,
    staleTime: 60_000,
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
