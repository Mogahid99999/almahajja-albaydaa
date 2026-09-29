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
} from '@/api/live';
import { queryKeys } from '@/constants/queryKeys';
import { notifyLiveSessionEnded, useLiveStore } from '@/stores/liveStore';

/** get_live_now cadence while foregrounded. */
export const LIVE_NOW_POLL_MS = 30_000;
const LIVE_SESSION_POLL_MS = 30_000;
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
 * Refetches every 30 s while foregrounded, on return to the foreground, and
 * whenever the store joins/leaves a session or it ends.
 */
export function useLiveNow() {
  const qc = useQueryClient();
  const active = useAppActive();
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
    if (active && !wasActive.current) {
      void qc.invalidateQueries({ queryKey: queryKeys.liveNow }, { cancelRefetch: false });
    }
    wasActive.current = active;
  }, [qc, active]);

  return useQuery({
    queryKey: queryKeys.liveNow,
    queryFn: getLiveNow,
    staleTime: 15_000,
    refetchInterval: active ? LIVE_NOW_POLL_MS : false,
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
  const query = useQuery({
    queryKey: queryKeys.liveSession(id ?? ''),
    queryFn: () => getLiveSession(id as string),
    enabled: !!id,
    staleTime: 15_000,
    refetchInterval: (q) => {
      if (!active) return false;
      const status = q.state.data?.status;
      return status && LIVE_OVER_STATUSES.has(status) ? false : LIVE_SESSION_POLL_MS;
    },
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
