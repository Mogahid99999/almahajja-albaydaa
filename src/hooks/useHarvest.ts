import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { getHarvest, type HarvestRange } from '@/api/harvest';
import { queryKeys } from '@/constants/queryKeys';

/** «حصاد الرحلة» totals for a range (V20 · §8). Off for guests. */
export function useHarvest(range: HarvestRange, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.harvest(range),
    queryFn: () => getHarvest(range),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}
