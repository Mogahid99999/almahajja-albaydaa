import { useQuery } from '@tanstack/react-query';

import { getStreakStatus } from '@/api/journey';
import { queryKeys } from '@/constants/queryKeys';

/**
 * Home StreakCard state (26.1): current streak, today-counted, recovery window.
 * Disabled for guests — the streak is part of رحلتي العلمية, gated behind
 * registration. Refreshed by useSaveProgress on every playback save.
 */
export function useStreakStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.streak,
    queryFn: getStreakStatus,
    enabled: options?.enabled ?? true,
  });
}
