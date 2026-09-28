/**
 * «البث المباشر» TanStack hooks (V23 P3) — wrap src/api/live.ts for the Home
 * card, section pin, room and share-link screens. The room connection itself is
 * src/stores/liveStore.ts.
 *
 * Polling only while the app is in the foreground (TanStack's focus manager has
 * no AppState signal on React Native, so it is driven explicitly here).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  getLiveByCode,
  getLiveNow,
  getLiveParticipantsForStaff,
  getLiveSession,
  LIVE_OVER_STATUSES,
  normalizeShareCode,
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
