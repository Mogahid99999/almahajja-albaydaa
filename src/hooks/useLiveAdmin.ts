/**
 * «البث المباشر» for staff (V23 P6) — TanStack hooks over src/api/liveAdmin.ts
 * for app/admin/live.tsx and the live items of «المحاضرات الواردة».
 *
 * Query keys live HERE (not in src/constants/queryKeys.ts), rooted at
 * ['live', 'admin', …]: the 'live' root is never persisted to the offline cache
 * (PERSISTED_QUERY_ROOTS) — these reads carry real participant names (D2).
 *
 * Polling only while the app/tab is in the foreground, and faster while
 * something is moving (a live session, a recording being compressed).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { cancelLiveSession } from '@/api/live';
import { getAdminLiveComments } from '@/api/liveComments';
import {
  downloadRawRecording,
  getLiveAdminOverview,
  getLiveInbox,
  getLiveInterventions,
  retryLiveRecording,
  saveLiveLecture,
  type LiveAdminOverview,
  type LiveAdminSession,
  type LiveInbox,
} from '@/api/liveAdmin';
import { queryKeys } from '@/constants/queryKeys';

export const liveAdminKeys = {
  all: ['live', 'admin'] as const,
  overview: ['live', 'admin', 'overview'] as const,
  inbox: ['live', 'admin', 'inbox'] as const,
  interventions: (sessionId: string) => ['live', 'admin', 'interventions', sessionId] as const,
};

/** While something is live or a recording is being compressed. */
export const LIVE_ADMIN_FAST_POLL_MS = 10_000;
export const LIVE_ADMIN_SLOW_POLL_MS = 45_000;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s !== 'background'));
    return () => sub.remove();
  }, []);
  return active;
}

/** A session whose card will change on its own soon (attendees, job progress). */
export function isMoving(s: LiveAdminSession): boolean {
  if (s.status === 'live' || s.status === 'green' || s.status === 'processing') return true;
  if (s.status === 'ended' && !s.lectureId) return true;
  return s.job?.status === 'queued' || s.job?.status === 'running';
}

export function overviewPollMs(data: LiveAdminOverview | undefined): number {
  if (!data) return LIVE_ADMIN_SLOW_POLL_MS;
  return data.active.length > 0 || data.recent.some(isMoving) ? LIVE_ADMIN_FAST_POLL_MS : LIVE_ADMIN_SLOW_POLL_MS;
}

export function inboxPollMs(data: LiveInbox | undefined): number {
  if (!data) return LIVE_ADMIN_SLOW_POLL_MS;
  return data.pending.some(isMoving) ? LIVE_ADMIN_FAST_POLL_MS : LIVE_ADMIN_SLOW_POLL_MS;
}

export function useLiveAdminOverview() {
  const active = useAppActive();
  return useQuery({
    queryKey: liveAdminKeys.overview,
    queryFn: () => getLiveAdminOverview(),
    staleTime: 5_000,
    refetchInterval: (q) => (active ? overviewPollMs(q.state.data) : false),
    refetchIntervalInBackground: false,
  });
}

/** Live drafts + recordings on their way — content managers only («الواردة»). */
export function useLiveInbox(enabled = true) {
  const active = useAppActive();
  return useQuery({
    queryKey: liveAdminKeys.inbox,
    queryFn: getLiveInbox,
    enabled,
    staleTime: 5_000,
    refetchInterval: (q) => (active && enabled ? inboxPollMs(q.state.data) : false),
    refetchIntervalInBackground: false,
  });
}

/** Who spoke and when in a session (real names, D2). Loaded per card. */
export function useLiveInterventions(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: liveAdminKeys.interventions(sessionId ?? ''),
    queryFn: () => getLiveInterventions(sessionId as string),
    enabled: !!sessionId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

/**
 * «التعليقات والأسئلة» of a session, kept after the majlis (admin_live_comments,
 * 0147): every comment incl. deleted ones, oldest first. Loaded when a card's
 * list is opened (queryKeys.liveAdminComments sits under liveAdminKeys.all, so
 * the screen's refresh reloads it too).
 */
export function useAdminLiveComments(sessionId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.liveAdminComments(sessionId ?? ''),
    queryFn: () => getAdminLiveComments(sessionId as string),
    enabled: enabled && !!sessionId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/** After anything that moves a live session / lecture: refresh every surface showing it. */
function useLiveAdminInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: liveAdminKeys.all });
    void qc.invalidateQueries({ queryKey: queryKeys.liveNow });
  };
}

/** «نشر» / «نشر بدون إشعار» / «حفظ دون نشر» on a live draft. */
export function useSaveLiveLecture() {
  const qc = useQueryClient();
  const invalidateLive = useLiveAdminInvalidate();
  return useMutation({
    mutationFn: saveLiveLecture,
    networkMode: 'always',
    onSuccess: () => {
      invalidateLive();
      void qc.invalidateQueries({ queryKey: queryKeys.unclassified });
      void qc.invalidateQueries({ queryKey: queryKeys.adminLectures });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      void qc.invalidateQueries({ queryKey: ['section'] });
      void qc.invalidateQueries({ queryKey: ['nextLectureOrder'] });
    },
  });
}

/** «إعادة المعالجة» — retry_live_recording. */
export function useRetryLiveRecording() {
  const invalidate = useLiveAdminInvalidate();
  return useMutation({
    mutationFn: retryLiveRecording,
    networkMode: 'always',
    onSettled: invalidate,
  });
}

/** «إلغاء» a scheduled / green session (content manager, or the host). */
export function useCancelLiveAdminSession() {
  const qc = useQueryClient();
  const invalidate = useLiveAdminInvalidate();
  return useMutation({
    mutationFn: cancelLiveSession,
    networkMode: 'always',
    onSettled: (_d, _e, id) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: queryKeys.liveSession(id) });
    },
  });
}

/** «تنزيل التسجيل الأصلي» via the media worker. */
export function useDownloadRawRecording() {
  return useMutation({
    mutationFn: (vars: { sessionId: string; title: string }) => downloadRawRecording(vars.sessionId, vars.title),
    networkMode: 'always',
  });
}

/** Refresh the staff live lists (e.g. right after a session was created). */
export function useRefreshLiveAdmin() {
  return useLiveAdminInvalidate();
}
