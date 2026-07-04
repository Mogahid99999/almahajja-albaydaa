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
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import {
  NOTIFICATION_TYPES,
  defaultNotificationEnabled,
  type NotificationData,
  type NotificationItem,
  type NotificationPrefs,
  type NotificationType,
} from './types';

export type {
  NotificationData,
  NotificationItem,
  NotificationPrefs,
  NotificationType,
  FollowState,
} from './types';

/** The signed-in user's id; personal tables all require it on write. */
async function requireUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  return user.id;
}

// --- Push tokens -------------------------------------------------------------
/** Upsert this device's Expo push token (PK = user_id, token → idempotent). */
export async function registerPushToken(token: string, platform: string): Promise<void> {
  if (USE_MOCK) return mock.registerPushToken(token, platform);
  const userId = await requireUserId();
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );
  if (error) throw error;
}

// --- Engagement / weekly goal ------------------------------------------------
/**
 * Stamp `profiles.last_opened_at = now()` for the signed-in user (drives the
 * weekly-goal cron + dispatcher). SECURITY DEFINER RPC touches only that one
 * column (profiles is otherwise admin-write). Best-effort; never blocks.
 */
export async function touchLastOpened(): Promise<void> {
  if (USE_MOCK) return;
  try {
    await supabase.rpc('touch_last_opened');
  } catch {
    // Non-fatal.
  }
}

/**
 * Atomically claim this week's goal-completion congrats: returns true exactly
 * once per week, the first time the target is met. The caller then presents the
 * local goal_done praise. Returns false (no congrats) on any error / mock.
 */
export async function tryClaimGoalCongrats(): Promise<boolean> {
  if (USE_MOCK) return false;
  const { data, error } = await supabase.rpc('try_claim_goal_congrats');
  if (error) return false;
  return data === true;
}

// --- Preferences -------------------------------------------------------------
/** Complete per-type map; a missing DB row resolves to ON (default). */
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (USE_MOCK) return mock.getNotificationPrefs();
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('type, enabled');
  if (error) throw error;
  const overrides = new Map((data ?? []).map((r) => [r.type, r.enabled]));
  return NOTIFICATION_TYPES.reduce((acc, type) => {
    // missing row = the type's default (ON for all but daily_reminder).
    acc[type] = overrides.has(type) ? overrides.get(type)! : defaultNotificationEnabled(type);
    return acc;
  }, {} as NotificationPrefs);
}

/** Set one type on/off (upsert by (user_id, type)). */
export async function setNotificationPref(
  type: NotificationType,
  enabled: boolean,
): Promise<void> {
  if (USE_MOCK) return mock.setNotificationPref(type, enabled);
  const userId = await requireUserId();
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, type, enabled }, { onConflict: 'user_id,type' });
  if (error) throw error;
}

// --- Inbox -------------------------------------------------------------------
export type NotificationPage = {
  items: NotificationItem[];
  /** `created_at` cursor for the next page, or null when this was the last page. */
  nextCursor: string | null;
};

const NOTIFICATIONS_PAGE_SIZE = 50;

/** One page of the user's notifications, newest first (bounded — P3 perf plan). */
export async function listNotifications(cursor?: string): Promise<NotificationPage> {
  if (USE_MOCK) {
    const items = await mock.listNotifications();
    return { items, nextCursor: null };
  }
  let query = supabase
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(NOTIFICATIONS_PAGE_SIZE);
  if (cursor) query = query.lt('created_at', cursor);
  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data ?? {}) as NotificationData,
    read: n.read_at !== null,
    createdAt: n.created_at,
  }));
  const nextCursor =
    items.length === NOTIFICATIONS_PAGE_SIZE ? items[items.length - 1].createdAt : null;
  return { items, nextCursor };
}

/** Mark a single notification read. */
export async function markNotificationRead(id: string): Promise<void> {
  if (USE_MOCK) return mock.markNotificationRead(id);
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Mark every unread notification read (تعليم الكل كمقروء). */
export async function markAllRead(): Promise<void> {
  if (USE_MOCK) return mock.markAllRead();
  const userId = await requireUserId();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

// --- Follows -----------------------------------------------------------------
/** Whether the current user follows a section (follow implies the subtree). */
export async function isSectionFollowed(sectionId: string): Promise<boolean> {
  if (USE_MOCK) return mock.isSectionFollowed(sectionId);
  const { data, error } = await supabase
    .from('section_follows')
    .select('section_id')
    .eq('section_id', sectionId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function followSection(sectionId: string): Promise<void> {
  if (USE_MOCK) return mock.followSection(sectionId);
  const userId = await requireUserId();
  // upsert keeps a double-tap idempotent (PK = user_id, section_id).
  const { error } = await supabase
    .from('section_follows')
    .upsert({ user_id: userId, section_id: sectionId }, { onConflict: 'user_id,section_id' });
  if (error) throw error;
}

export async function unfollowSection(sectionId: string): Promise<void> {
  if (USE_MOCK) return mock.unfollowSection(sectionId);
  const userId = await requireUserId();
  const { error } = await supabase
    .from('section_follows')
    .delete()
    .eq('user_id', userId)
    .eq('section_id', sectionId);
  if (error) throw error;
}
