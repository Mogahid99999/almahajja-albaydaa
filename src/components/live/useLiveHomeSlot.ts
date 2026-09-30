/**
 * Which live — if any — takes Home's «أكمِل الاستماع» slot (V23 §7.3; owner
 * 2026-09-29: «عند انتهاء البث بالصفحة الرئيسية يجب ان يرجع مربع اخر محاضرة»).
 *
 * Why the slot used to stay on «مباشر الآن» after the end: live-control `end`
 * deletes the LiveKit room BEFORE it writes status 'ended'. Listeners get
 * ROOM_DELETED (store conn → 'ended') at once, and useLiveNow's refetch on that
 * change reaches get_live_now while the row still says 'live' — the cached
 * answer then kept the live card (with «العودة إلى الحلقة») up until the next
 * 30 s poll, and again on every return to Home from the stale persisted cache.
 *
 * Now the slot trusts what THIS device already knows:
 *  - a session the store saw end (conn 'ended'), or whose own query
 *    (useLiveSession) reached an over status, is never shown again — kept in a
 *    module-level set so it survives dismissing the mini-bar and Home remounts;
 *  - a few seconds after the end, get_live_now is refetched once more (the
 *    server has flipped by then), and when the slot goes back from a live to
 *    none, Home's own data is refreshed so the ContinueCard has the latest
 *    «آخر محاضرة» position (the live stopped the lecture player on join).
 * The mini-bar may keep «انتهى المجلس» until dismissed — that is the store's.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { LIVE_OVER_STATUSES, type LiveNow, type LiveSessionPublic } from '@/api/live';
import { queryKeys } from '@/constants/queryKeys';
import { useLiveStore } from '@/stores/liveStore';

/** get_live_now again this long after the room ended here (the status write lags the room delete). */
export const LIVE_END_RECHECK_MS = 4_000;

/** Sessions this device saw end (this app run). */
const endedHere = new Set<string>();

/** Test hook: forget what was seen. */
export function resetLiveHomeSlot(): void {
  endedHere.clear();
}

/** The live for Home's slot: null when there is none, or it is over by any account. */
export function liveForHome(
  live: LiveSessionPublic | null | undefined,
  ended: ReadonlySet<string>,
  cachedStatus?: (id: string) => LiveSessionPublic['status'] | null | undefined,
): LiveSessionPublic | null {
  if (!live) return null;
  if (LIVE_OVER_STATUSES.has(live.status)) return null;
  if (ended.has(live.id)) return null;
  const st = cachedStatus?.(live.id);
  if (st && LIVE_OVER_STATUSES.has(st)) return null;
  return live;
}

export function useLiveHomeSlot(liveNow: LiveNow | null | undefined): LiveSessionPublic | null {
  const qc = useQueryClient();
  const endedId = useLiveStore((s) => (s.conn === 'ended' && s.session ? s.session.id : null));
  if (endedId) endedHere.add(endedId);

  // The server flips to 'ended' right after the room is gone: ask again shortly.
  useEffect(() => {
    if (!endedId) return;
    const t = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: queryKeys.liveNow });
    }, LIVE_END_RECHECK_MS);
    return () => clearTimeout(t);
  }, [endedId, qc]);

  const live = liveForHome(liveNow?.live, endedHere, (id) => {
    const cached = qc.getQueryData<LiveSessionPublic | null>(queryKeys.liveSession(id));
    if (cached?.status && LIVE_OVER_STATUSES.has(cached.status)) endedHere.add(id);
    return cached?.status;
  });

  // Live → none: refresh Home so «أكمِل الاستماع» shows the latest resume point.
  const shownId = live?.id ?? null;
  const prevShown = useRef<string | null>(shownId);
  useEffect(() => {
    if (prevShown.current && !shownId) {
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    }
    prevShown.current = shownId;
  }, [shownId, qc]);

  return live;
}
