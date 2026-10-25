/**
 * app_open (migration 0156, LOAD V24) — ONE round trip per app foreground.
 *
 * Replaces what every open used to fire separately: touch_last_opened, the
 * GoTrue /user ban check, notification_prefs, the resumable-lesson probe, the
 * inbox list, every cached buddy query, get_live_now and the UpdateGate config
 * read. The caller (src/lib/appOpen.ts) refetches only what this says changed.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

import type { AppVersionGate } from './appVersion';

export type AppOpenBuddyCounts = { incoming: number; outgoing: number; goalInvites: number };

export type AppOpenResult = {
  /** false = the account is gone (deleted) while its JWT is still valid → sign out. */
  userExists: boolean;
  banned: boolean;
  unread: number;
  latestNotificationAt: string | null;
  buddy: AppOpenBuddyCounts;
  dailyReminder: boolean;
  hasResumable: boolean;
  /** get_live_now() payload, same shape the liveNow query caches (raw). */
  live: unknown;
  version: AppVersionGate;
  /** 0158: «الجدول الأسبوعي» version stamp — refetch get_schedule only when it moves. */
  scheduleVersion: string | null;
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Shape-check the RPC's jsonb (never trust a server payload blindly). */
export function parseAppOpen(raw: unknown): AppOpenResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.user_exists !== true) {
    return {
      userExists: false,
      banned: false,
      unread: 0,
      latestNotificationAt: null,
      buddy: { incoming: 0, outgoing: 0, goalInvites: 0 },
      dailyReminder: false,
      hasResumable: false,
      live: null,
      version: { minVersion: null, downloadUrl: null, latestVersion: null, latestReleasedAt: null },
      scheduleVersion: null,
    };
  }
  const b = (r.buddy ?? {}) as Record<string, unknown>;
  const v = (r.version ?? {}) as Record<string, unknown>;
  return {
    userExists: true,
    banned: r.banned === true,
    unread: num(r.unread),
    latestNotificationAt: str(r.latest_notification_at),
    buddy: { incoming: num(b.incoming), outgoing: num(b.outgoing), goalInvites: num(b.goal_invites) },
    dailyReminder: r.daily_reminder === true,
    hasResumable: r.has_resumable === true,
    live: r.live ?? null,
    version: {
      minVersion: str(v.min_app_version),
      downloadUrl: str(v.app_download_url),
      latestVersion: str(v.latest_app_version),
      latestReleasedAt: str(v.latest_released_at),
    },
    scheduleVersion: str(r.schedule_version),
  };
}

/** Throws on a transport/server error — the caller treats that as "skip this round". */
export async function appOpen(): Promise<AppOpenResult | null> {
  if (USE_MOCK) return null;
  const { data, error } = await supabase.rpc('app_open');
  if (error) throw error;
  return parseAppOpen(data);
}
