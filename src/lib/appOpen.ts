/**
 * App-open orchestration (LOAD V24). One `app_open` RPC (0156) per foreground —
 * at most every 15 min, forced on a cold start — then refetch ONLY what it says
 * changed. Before V24 every foreground fired 8–12 requests (touch, GoTrue ban
 * check, prefs, resumable probe, inbox, every cached buddy query, live card);
 * 2026-10-04 ~70 opens of that kind were enough to tip the Nano DB into swap.
 *
 * The decision logic is pure (decideAppOpenEffects) and unit-tested; runAppOpen
 * wires it to the query cache, the reminder scheduler and the sign-out path.
 */
import { appOpen, type AppOpenBuddyCounts, type AppOpenResult } from '@/api/appOpen';
import { parseLiveNow } from '@/api/live';
import { queryKeys } from '@/constants/queryKeys';
import { cancelDailyReminder, scheduleDailyReminder } from '@/lib/notifications';
import { queryClient } from '@/lib/queryClient';

/** A foreground within this window of the last successful run does nothing. */
export const APP_OPEN_MIN_INTERVAL_MS = 15 * 60_000;
/** After a failed run, wait at least this long before trying again. */
export const APP_OPEN_RETRY_AFTER_FAILURE_MS = 2 * 60_000;

/** Last buddy counts seen — under the persisted 'buddy' root, so it survives a cold start. */
export const BUDDY_OPEN_COUNTS_KEY = ['buddy', 'openCounts'] as const;

export type AppOpenEffects = {
  signOut: boolean;
  refetchInbox: boolean;
  refetchBuddy: boolean;
  /** true → (re)arm the local daily reminder, false → cancel it. */
  scheduleDailyReminder: boolean;
  /** 0158: the weekly schedule changed on the server (and the device has a copy). */
  refetchSchedule: boolean;
};

export type AppOpenCacheView = {
  /** created_at of the newest inbox item already in the cache, null = no inbox cached. */
  newestCachedNotificationAt: string | null;
  /** unread items among the cached inbox pages, null = no inbox cached. */
  cachedUnread: number | null;
  /** counts from the previous run (persisted), null = never ran on this device. */
  prevBuddy: AppOpenBuddyCounts | null;
  /** version of the cached weekly schedule; null = none cached (the screen fetches it). */
  cachedScheduleVersion?: string | null;
};

/**
 * A broadcast push (a new lesson → lectureId, a new file → sectionId, a live
 * start → /live/…) is push-only since 0151: tapping it changes no inbox or
 * buddy state, so the tap handler refetches nothing for it. Same for the local
 * «ذكّرني قبل الدرس» reminder (0158) — many phones tap it in the same 15 minutes.
 */
export function isBroadcastPush(data: { lectureId?: string; sectionId?: string; route?: string }): boolean {
  const route = data.route ?? '';
  return !!data.lectureId || !!data.sectionId || route.startsWith('/live/') || route === '/(student)/schedule';
}

export function appOpenDue(nowMs: number, nextAllowedAtMs: number, force: boolean): boolean {
  return force || nowMs >= nextAllowedAtMs;
}

const sameBuddy = (a: AppOpenBuddyCounts, b: AppOpenBuddyCounts) =>
  a.incoming === b.incoming && a.outgoing === b.outgoing && a.goalInvites === b.goalInvites;

export function decideAppOpenEffects(r: AppOpenResult, view: AppOpenCacheView): AppOpenEffects {
  if (!r.userExists || r.banned) {
    return {
      signOut: true,
      refetchInbox: false,
      refetchBuddy: false,
      scheduleDailyReminder: false,
      refetchSchedule: false,
    };
  }
  let refetchInbox = false;
  if (view.newestCachedNotificationAt !== null) {
    const newer =
      !!r.latestNotificationAt &&
      Date.parse(r.latestNotificationAt) > Date.parse(view.newestCachedNotificationAt);
    // Read/unread flipped elsewhere (another device, «تعليم الكل»): only the
    // none↔some transitions matter — the cache holds 50 items, the server counts all.
    const unreadFlip =
      view.cachedUnread !== null && (r.unread === 0) !== (view.cachedUnread === 0);
    refetchInbox = newer || unreadFlip;
  } else if (view.cachedUnread !== null && r.latestNotificationAt) {
    // Cached inbox is empty but the server now has items.
    refetchInbox = true;
  }
  return {
    signOut: false,
    refetchInbox,
    refetchBuddy: view.prevBuddy !== null && !sameBuddy(view.prevBuddy, r.buddy),
    scheduleDailyReminder: r.dailyReminder && !r.hasResumable,
    refetchSchedule:
      !!r.scheduleVersion && view.cachedScheduleVersion != null && view.cachedScheduleVersion !== r.scheduleVersion,
  };
}

type InboxCache = { pages?: { items?: { createdAt?: string; read?: boolean }[] }[] };

function readCacheView(): AppOpenCacheView {
  const inbox = queryClient.getQueryData<InboxCache>(queryKeys.notifications);
  const items = inbox?.pages?.flatMap((p) => p.items ?? []) ?? null;
  return {
    newestCachedNotificationAt: items && items.length > 0 ? (items[0].createdAt ?? null) : null,
    cachedUnread: items ? items.reduce((n, i) => (i.read ? n : n + 1), 0) : null,
    prevBuddy: queryClient.getQueryData<AppOpenBuddyCounts>(BUDDY_OPEN_COUNTS_KEY) ?? null,
    cachedScheduleVersion:
      queryClient.getQueryData<{ version: string | null }>(queryKeys.schedule)?.version ?? null,
  };
}

let nextAllowedAt = 0;
let inFlight: Promise<void> | null = null;

/** Test seam: forget the throttle between tests. */
export function __resetAppOpenForTests(): void {
  nextAllowedAt = 0;
  inFlight = null;
}

/**
 * Run app_open if due and apply its effects. Never throws. `onSignedOut` runs
 * the forced sign-out (banned / deleted account) — the caller owns that path.
 */
export function runAppOpen(opts: { force?: boolean; onSignedOut: () => Promise<void> | void }): Promise<void> {
  const now = Date.now();
  if (inFlight) return inFlight;
  if (!appOpenDue(now, nextAllowedAt, !!opts.force)) return Promise.resolve();
  nextAllowedAt = now + APP_OPEN_MIN_INTERVAL_MS;
  inFlight = (async () => {
    let result: AppOpenResult | null;
    try {
      result = await appOpen();
    } catch {
      // Network / server trouble: fail quiet, retry on a later foreground — never in a loop.
      nextAllowedAt = Date.now() + APP_OPEN_RETRY_AFTER_FAILURE_MS;
      return;
    }
    if (!result) return;
    const effects = decideAppOpenEffects(result, readCacheView());
    if (effects.signOut) {
      await opts.onSignedOut();
      return;
    }
    // Seed what the open already answered, so no screen asks again.
    queryClient.setQueryData(queryKeys.liveNow, parseLiveNow(result.live));
    queryClient.setQueryData(['appVersionGate'], result.version);
    queryClient.setQueryData(BUDDY_OPEN_COUNTS_KEY, result.buddy);
    if (effects.refetchInbox) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.homeBroadcasts });
    }
    if (effects.refetchSchedule) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedule });
    }
    if (effects.refetchBuddy) {
      void queryClient.invalidateQueries({
        queryKey: ['buddy'],
        predicate: (q) => q.queryKey[1] !== 'openCounts',
      });
    }
    try {
      if (effects.scheduleDailyReminder) await scheduleDailyReminder();
      else await cancelDailyReminder();
    } catch {
      // Non-fatal — a missed re-arm never blocks the app.
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
