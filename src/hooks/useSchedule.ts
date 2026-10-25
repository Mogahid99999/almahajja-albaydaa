/**
 * «الجدول الأسبوعي للدروس» (0158) — TanStack hooks over src/api/schedule.ts.
 *
 * useSchedule: ONE persisted read; staleTime a day — app_open refetches it the
 * moment the server's schedule_version moves (src/lib/appOpen.ts), so an edit
 * reaches students on their next open and nothing polls.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  deleteScheduleException,
  deleteScheduleItem,
  EMPTY_SCHEDULE,
  getSchedule,
  saveScheduleException,
  saveScheduleItem,
  setScheduleItemActive,
  type Schedule,
} from '@/api/schedule';
import { queryKeys } from '@/constants/queryKeys';
import { syncScheduleReminders } from '@/lib/scheduleReminders';
import { useScheduleRemindersStore } from '@/stores/scheduleRemindersStore';

export const SCHEDULE_STALE_MS = 24 * 3600_000;

export function useSchedule(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.schedule,
    queryFn: getSchedule,
    staleTime: SCHEDULE_STALE_MS,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/**
 * Keep the local «ذكّرني» notifications in step with the schedule and my
 * choices — only when either actually changes (version / ids), never per render.
 */
export function useScheduleReminderSync(schedule: Schedule | undefined) {
  const ids = useScheduleRemindersStore((s) => s.ids);
  const jitterMs = useScheduleRemindersStore((s) => s.jitterMs);
  const idsKey = ids.join(',');
  const version = schedule?.version ?? null;
  const exceptionsKey = schedule ? schedule.exceptions.length : 0;
  useEffect(() => {
    if (!schedule) return;
    void syncScheduleReminders(schedule, ids, jitterMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, idsKey, exceptionsKey, jitterMs]);
}

function useInvalidateSchedule() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.schedule });
}

export function useSaveScheduleItem() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: saveScheduleItem, networkMode: 'always', onSettled: invalidate });
}

export function useSetScheduleItemActive() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setScheduleItemActive(id, isActive),
    networkMode: 'always',
    onSettled: invalidate,
  });
}

export function useDeleteScheduleItem() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: deleteScheduleItem, networkMode: 'always', onSettled: invalidate });
}

export function useSaveScheduleException() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: saveScheduleException, networkMode: 'always', onSettled: invalidate });
}

export function useDeleteScheduleException() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: deleteScheduleException, networkMode: 'always', onSettled: invalidate });
}

export { EMPTY_SCHEDULE };
