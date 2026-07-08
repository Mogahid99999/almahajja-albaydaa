import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminDeleteRating, adminListRatings, submitRating } from '@/api/ratings';
import { queryKeys } from '@/constants/queryKeys';

export function useSubmitRating() {
  return useMutation({
    mutationFn: (vars: { stars: number; message?: string }) =>
      submitRating(vars.stars, vars.message),
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export function useAdminRatings() {
  return useQuery({
    queryKey: queryKeys.adminRatingsList,
    queryFn: adminListRatings,
  });
}

export function useAdminDeleteRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ratingId: string) => adminDeleteRating(ratingId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.adminRatingsList });
      void qc.invalidateQueries({ queryKey: queryKeys.adminRatingsSummary });
    },
  });
}
