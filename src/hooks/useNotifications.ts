import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getNotificationPrefs,
  listNotifications,
  markAllRead,
  markNotificationRead,
  setNotificationPref,
} from '@/api/notifications';
import type { NotificationType } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';

/** The الإشعارات inbox, newest first. */
export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: listNotifications,
  });
}

/**
 * Count of unread notifications, derived from the inbox query (no separate
 * fetch). Drives the single quiet brass dot — never shown as a loud number
 * badge.
 */
export function useUnreadCount(): number {
  const { data } = useNotifications();
  return (data ?? []).reduce((n, item) => (item.read ? n : n + 1), 0);
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

/** Toggle one notification type; refresh the prefs map. */
export function useSetNotificationPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { type: NotificationType; enabled: boolean }) =>
      setNotificationPref(vars.type, vars.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notificationPrefs }),
  });
}

// The "follow a section" feature was removed — new-lecture / new-attachment
// notifications now fan out to ALL students (gated by per-type prefs), so
// following is no longer needed. The section_follows table + its api functions
// remain in place but unused (migration 0007). See PLAN_ADMIN_FIXES item B.
