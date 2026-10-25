/**
 * «البث المباشر» TanStack hooks (V23 P3) — wrap src/api/live.ts for the Home
 * card, section pin, room and share-link screens. The room connection itself is
 * src/stores/liveStore.ts.
 *
 * Polling only while the app is in the foreground (TanStack's focus manager has
 * no AppState signal on React Native, so it is driven explicitly here).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

import {
  cancelLiveSession,
  createLiveSession,
  getLiveBuddiesPresent,
  getLiveByCode,
  getLiveInvitedBuddyIds,
  getLiveNow,
  getLiveParticipantsForStaff,
  getLiveSession,
  inviteBuddyToLive,
  LIVE_OVER_STATUSES,
  normalizeShareCode,
  setLiveReminder,
  type LiveNow,
  type LiveStatus,
} from '@/api/live';
import { queryKeys } from '@/constants/queryKeys';
import { notifyLiveSessionEnded, useLiveStore } from '@/stores/liveStore';

/**
 * get_live_now cadence (LOAD V24). Was every 30 s on every foreground app, on
 * any screen — thousands of polls a minute during a live. Now only while a
 * screen showing it (Home / the section pin) is focused, and:
 *  - 60 s while a session is live or one is due within 2 h (start / end show
 *    up within a minute; the start push deep-links straight into the room);
 *  - 10 min otherwise (nothing to announce; app_open re-seeds it on each open).
 */
export const LIVE_NOW_ACTIVE_POLL_MS = 60_000;
export const LIVE_NOW_IDLE_POLL_MS = 10 * 60_000;
const LIVE_NOW_SOON_MS = 2 * 3600_000;
/** On return to the foreground, refetch only if app_open hasn't just refreshed it. */
const LIVE_NOW_RESUME_GRACE_MS = 3_000;
const LIVE_NOW_RESUME_MAX_AGE_MS = 60_000;
/** Room screen: the session is mostly ended by LiveKit's ROOM_DELETED; this is the fallback. */
const LIVE_SESSION_POLL_MS = 90_000;
/**
 * …except while this device is still entering / re-entering the room: a join
 * gets no ROOM_DELETED, so an end made elsewhere must stop it within seconds
 * (owner 2026-10-05 «معلق»). A normal join connects in 1–3 s, so only a join
 * that is actually stuck ever polls at this pace.
 */
export const LIVE_SESSION_JOINING_POLL_MS = 10_000;

/** The room screen's session poll: off once over; fast only while this device is still joining. */
export function liveSessionPollMs(status: LiveStatus | undefined, joining: boolean): number | false {
  if (status && LIVE_OVER_STATUSES.has(status)) return false;
  return joining ? LIVE_SESSION_JOINING_POLL_MS : LIVE_SESSION_POLL_MS;
}

export function liveNowPollMs(data: LiveNow | undefined, nowMs: number): number {
  if (!data) return LIVE_NOW_IDLE_POLL_MS;
  if (data.live) return LIVE_NOW_ACTIVE_POLL_MS;
  const soon = data.upcoming.some((s) => {
    const at = s.scheduledAt ? Date.parse(s.scheduledAt) : NaN;
    return Number.isFinite(at) && at - nowMs < LIVE_NOW_SOON_MS;
  });
  return soon ? LIVE_NOW_ACTIVE_POLL_MS : LIVE_NOW_IDLE_POLL_MS;
}
const STAFF_PARTICIPANTS_POLL_MS = 15_000;
/** Real names (D2) are dropped from memory soon after the staff sheet closes. */
const STAFF_PARTICIPANTS_GC_MS = 5 * 60_000;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s !== 'background'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * The live session now + the next scheduled ones (+ my «ذكّرني» flags).
 * Polled (liveNowPollMs) only while foregrounded AND this screen is focused, on
 * return to the foreground when app_open didn't just re-seed it, and whenever
 * the store joins/leaves a session or it ends.
 */
export function useLiveNow() {
  const qc = useQueryClient();
  const active = useAppActive();
  const focused = useIsFocused();
  const sessionId = useLiveStore((s) => s.session?.id ?? null);
  const ended = useLiveStore((s) => s.conn === 'ended');

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void qc.invalidateQueries({ queryKey: queryKeys.liveNow }, { cancelRefetch: false });
  }, [qc, sessionId, ended]);

  const wasActive = useRef(active);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (active && !wasActive.current) {
      // app_open (≤ every 15 min) seeds this cache on the same foreground —
      // give it a moment, then refetch only if the data is still old.
      timer = setTimeout(() => {
        const updatedAt = qc.getQueryState(queryKeys.liveNow)?.dataUpdatedAt ?? 0;
        if (Date.now() - updatedAt > LIVE_NOW_RESUME_MAX_AGE_MS) {
          void qc.invalidateQueries({ queryKey: queryKeys.liveNow }, { cancelRefetch: false });
        }
      }, LIVE_NOW_RESUME_GRACE_MS);
    }
    wasActive.current = active;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [qc, active]);

  return useQuery({
    queryKey: queryKeys.liveNow,
    queryFn: getLiveNow,
    staleTime: 15_000,
    refetchInterval: (q) => (active && focused ? liveNowPollMs(q.state.data, Date.now()) : false),
    refetchIntervalInBackground: false,
  });
}

/**
 * One session (the room screen). Polled while it can still change; an
 * over status (ended/processing/ready/…) ends the store's room too, even if the
 * ROOM_DELETED disconnect was missed.
 */
export function useLiveSession(id: string | null | undefined) {
  const active = useAppActive();
  const joining = useLiveStore(
    (s) => !!id && s.session?.id === id && (s.conn === 'connecting' || s.conn === 'reconnecting'),
  );
  const query = useQuery({
    queryKey: queryKeys.liveSession(id ?? ''),
    queryFn: () => getLiveSession(id as string),
    enabled: !!id,
    staleTime: 15_000,
    refetchInterval: (q) => (active ? liveSessionPollMs(q.state.data?.status, joining) : false),
    refetchIntervalInBackground: false,
  });
  const status = query.data?.status;
  useEffect(() => {
    if (id && status && LIVE_OVER_STATUSES.has(status)) notifyLiveSessionEnded(id);
  }, [id, status]);
  return query;
}

/** Share-link entry (`/live/code/[code]`): null for an unknown / cancelled / gender-restricted code. */
export function useLiveByCode(code: string | null | undefined) {
  const normalized = code ? (normalizeShareCode(code) ?? code) : '';
  return useQuery({
    queryKey: queryKeys.liveByCode(normalized),
    queryFn: () => getLiveByCode(normalized),
    enabled: !!normalized,
    staleTime: 30_000,
  });
}

/**
 * Staff only (D2): every participant with the REAL name, incl. sisters who
 * chose «بدون اسم». `enabled` should be true only for moderators with the
 * people sheet open.
 */
export function useLiveStaffParticipants(sessionId: string | null | undefined, enabled: boolean) {
  const active = useAppActive();
  const on = enabled && !!sessionId;
  return useQuery({
    queryKey: queryKeys.liveStaffParticipants(sessionId ?? ''),
    queryFn: () => getLiveParticipantsForStaff(sessionId as string),
    enabled: on,
    staleTime: 10_000,
    gcTime: STAFF_PARTICIPANTS_GC_MS,
    refetchInterval: on && active ? STAFF_PARTICIPANTS_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** Section page «ابدأ مجلساً مباشراً» → green room. Resolves to the new session id. */
export function useCreateLiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createLiveSession,
    networkMode: 'always',
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.liveNow }),
  });
}

/** Green room «إلغاء» (scheduled/green only). */
export function useCancelLiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cancelLiveSession,
    networkMode: 'always',
    onSettled: (_d, _e, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.liveNow });
      void qc.invalidateQueries({ queryKey: queryKeys.liveSession(id) });
    },
  });
}

// ─── P5: «ذكّرني», buddy invite (PLAN_LIVE_V23 §9, migration 0142) ────────────

const BUDDIES_PRESENT_POLL_MS = 15_000;

/** remindedIds with `id` added (on) or removed (off). */
export function withReminder(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

/**
 * «ذكّرني» / cancel on a scheduled session (set_live_reminder). Optimistic: the
 * get_live_now cache flips at once and rolls back on failure; the server's
 * answer is refetched either way. networkMode 'always' so an offline tap fails
 * (and rolls back) instead of sitting paused.
 */
export function useSetLiveReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, on }: { sessionId: string; on: boolean }) => setLiveReminder(sessionId, on),
    networkMode: 'always',
    onMutate: async ({ sessionId, on }) => {
      await qc.cancelQueries({ queryKey: queryKeys.liveNow });
      const prev = qc.getQueryData<LiveNow>(queryKeys.liveNow);
      if (prev) {
        qc.setQueryData<LiveNow>(queryKeys.liveNow, {
          ...prev,
          remindedIds: withReminder(prev.remindedIds, sessionId, on),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.liveNow, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.liveNow }),
  });
}

/**
 * «رفيقك · حسن»: my buddies in this room now (identities). Only while the
 * invite sheet is open (`enabled`), polled every 15 s in the foreground.
 */
export function useLiveBuddiesPresent(sessionId: string | null | undefined, enabled: boolean) {
  const active = useAppActive();
  const on = enabled && !!sessionId;
  return useQuery({
    queryKey: queryKeys.liveBuddiesPresent(sessionId ?? ''),
    queryFn: () => getLiveBuddiesPresent(sessionId as string),
    enabled: on,
    staleTime: 10_000,
    refetchInterval: on && active ? BUDDIES_PRESENT_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** Buddies I already invited to this session (disabled rows in the sheet). */
export function useLiveInvited(sessionId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.liveInvited(sessionId ?? ''),
    queryFn: () => getLiveInvitedBuddyIds(sessionId as string),
    enabled: enabled && !!sessionId,
    staleTime: 60_000,
  });
}

/**
 * invite_buddy_to_live. Every outcome (sent / muted / already) marks the buddy
 * invited in the cache, so the row disables at once.
 */
export function useInviteBuddyToLive(sessionId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buddyId: string) => inviteBuddyToLive(sessionId as string, buddyId),
    networkMode: 'always',
    onSuccess: (_r, buddyId) => {
      if (!sessionId) return;
      qc.setQueryData<string[]>(queryKeys.liveInvited(sessionId), (old) =>
        old?.includes(buddyId) ? old : [...(old ?? []), buddyId],
      );
    },
  });
}
