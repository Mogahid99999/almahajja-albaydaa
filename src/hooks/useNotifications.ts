import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getNotificationPrefs,
  listNotifications,
  markAllRead,
  markNotificationRead,
  setNotificationPref,
} from '@/api/notifications';
import type { NotificationType } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';
import { cancelDailyReminder, scheduleDailyReminder } from '@/lib/notifications';

/** The الإشعارات inbox, newest first — paginated 50/page (P3 perf plan). */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ pageParam }) => listNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Flattened items across all loaded pages, newest first. */
export function useNotificationItems() {
  const { data } = useNotifications();
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/**
 * Count of unread notifications, derived from the loaded inbox pages (no
 * separate fetch). Drives the single quiet brass dot — never shown as a loud
 * number badge. Only reflects pages already loaded, same as the visible list.
 */
export function useUnreadCount(): number {
  const items = useNotificationItems();
  return items.reduce((n, item) => (item.read ? n : n + 1), 0);
}

/** Mark one notification read; refresh the inbox (and thus the unread dot). */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

/** تعليم الكل كمقروء — clear every unread, then refresh. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

/** Resolved per-type on/off map (absence of a row = ON). */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: queryKeys.notificationPrefs,
    queryFn: getNotificationPrefs,
  });
}

/**
 * Toggle one notification type; refresh the prefs map. `daily_reminder` is the
 * one type with an on-device side-effect: the OS repeating reminder is scheduled
 * when turned on and cancelled when turned off (both no-op on web / Expo Go /
 * without permission, so this never blocks).
 */
export function useSetNotificationPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { type: NotificationType; enabled: boolean }) => {
      await setNotificationPref(vars.type, vars.enabled);
      if (vars.type === 'daily_reminder') {
        if (vars.enabled) await scheduleDailyReminder();
        else await cancelDailyReminder();
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notificationPrefs }),
  });
}

// The "follow a section" feature was removed — new-lecture / new-attachment
// notifications now fan out to ALL students (gated by per-type prefs), so
// following is no longer needed. The section_follows table + its api functions
// remain in place but unused (migration 0007). See PLAN_ADMIN_FIXES item B.
