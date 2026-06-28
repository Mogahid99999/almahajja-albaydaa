/**
 * Notifications data access — الإشعارات (Phase 2 · feature B).
 *
 * Follows + per-type prefs + the in-app inbox. Personal-only, calm tone (a
 * single quiet brass dot for unread — no counts-as-badges noise). While
 * `USE_MOCK` is true everything is served from `src/mock/*`; the live Supabase
 * path (tables + own-rows RLS in supabase/migrations/0003) is wired at the §4
 * live cutover. The cross-user FAN-OUT (notify-on-publish Edge Function /
 * SECURITY DEFINER + Expo Push) is deferred — in mock it's faked locally.
 *
 * Components never import supabase directly (CLAUDE.md conventions).
 */
import { USE_MOCK } from '@/config';
import * as mock from '@/mock/api';
import type {
  NotificationItem,
  NotificationPrefs,
  NotificationType,
} from './types';

export type {
  NotificationData,
  NotificationItem,
  NotificationPrefs,
  NotificationType,
  FollowState,
} from './types';

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

// --- Push tokens -------------------------------------------------------------
/** Upsert this device's Expo push token (PK = user_id, token → idempotent). */
export async function registerPushToken(token: string, platform: string): Promise<void> {
  if (USE_MOCK) return mock.registerPushToken(token, platform);
  throw NOT_LIVE('registerPushToken'); // → upsert public.push_tokens
}

// --- Preferences -------------------------------------------------------------
/** Complete per-type map; a missing DB row resolves to ON (default). */
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (USE_MOCK) return mock.getNotificationPrefs();
  throw NOT_LIVE('getNotificationPrefs'); // → select public.notification_prefs
}

/** Set one type on/off (upsert by (user_id, type)). */
export async function setNotificationPref(
  type: NotificationType,
  enabled: boolean,
): Promise<void> {
  if (USE_MOCK) return mock.setNotificationPref(type, enabled);
  throw NOT_LIVE('setNotificationPref'); // → upsert public.notification_prefs
}

// --- Inbox -------------------------------------------------------------------
/** The user's notifications, newest first. */
export async function listNotifications(): Promise<NotificationItem[]> {
  if (USE_MOCK) return mock.listNotifications();
  throw NOT_LIVE('listNotifications'); // → select public.notifications order by created_at desc
}

/** Mark a single notification read. */
export async function markNotificationRead(id: string): Promise<void> {
  if (USE_MOCK) return mock.markNotificationRead(id);
  throw NOT_LIVE('markNotificationRead'); // → update public.notifications set read_at = now()
}

/** Mark every unread notification read (تعليم الكل كمقروء). */
export async function markAllRead(): Promise<void> {
  if (USE_MOCK) return mock.markAllRead();
  throw NOT_LIVE('markAllRead'); // → update public.notifications where read_at is null
}

// --- Follows -----------------------------------------------------------------
/** Whether the current user follows a section (follow implies the subtree). */
export async function isSectionFollowed(sectionId: string): Promise<boolean> {
  if (USE_MOCK) return mock.isSectionFollowed(sectionId);
  throw NOT_LIVE('isSectionFollowed'); // → select 1 from public.section_follows
}

export async function followSection(sectionId: string): Promise<void> {
  if (USE_MOCK) return mock.followSection(sectionId);
  throw NOT_LIVE('followSection'); // → insert public.section_follows
}

export async function unfollowSection(sectionId: string): Promise<void> {
  if (USE_MOCK) return mock.unfollowSection(sectionId);
  throw NOT_LIVE('unfollowSection'); // → delete public.section_follows
}
