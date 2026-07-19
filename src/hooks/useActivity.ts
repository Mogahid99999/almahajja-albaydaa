import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { getActivityCalendar } from '@/api/activity';
import { queryKeys } from '@/constants/queryKeys';

/**
 * The activity calendar for one month (V20 · §7). `monthAnchor` is any YYYY-MM-DD
 * in the target month; the RPC clamps to the whole month. Off for guests.
 */
export function useActivityCalendar(monthAnchor: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.activityCalendar(monthAnchor.slice(0, 7)),
    queryFn: () => getActivityCalendar(monthAnchor),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}
