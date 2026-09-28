/**
 * Server-side lecture compression hooks (V23 §6.1) — wrap src/api/mediaJobs.ts
 * for the admin upload screen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import {
  createServerTranscodeLecture,
  discardRawUpload,
  enqueueLectureTranscode,
  getMediaJob,
  isServerTranscodeEnabled,
  uploadRawLecture,
} from '@/api/mediaJobs';
import { queryKeys } from '@/constants/queryKeys';

/** Poll cadence for a running job (plan §6.1: every 2 s). */
export const MEDIA_JOB_POLL_MS = 2000;

/** app_config `server_transcode` — false while loading or on any read error. */
export function useServerTranscodeFlag() {
  return useQuery({
    queryKey: queryKeys.serverTranscodeFlag,
    queryFn: isServerTranscodeEnabled,
    staleTime: 60_000,
  });
}

function useInvalidateLectureLists() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.adminLectures });
    qc.invalidateQueries({ queryKey: queryKeys.unclassified });
    qc.invalidateQueries({ queryKey: queryKeys.home });
    qc.invalidateQueries({ queryKey: ['section'] });
    qc.invalidateQueries({ queryKey: ['nextLectureOrder'] });
  };
}

/**
 * One media job, polled every 2 s until it is `done` or `failed`. When it
 * finishes, the admin lecture lists refetch so the row shows its audio.
 */
export function useMediaJob(jobId: string | null) {
  const invalidate = useInvalidateLectureLists();
  const query = useQuery({
    queryKey: queryKeys.mediaJob(jobId ?? ''),
    queryFn: () => getMediaJob(jobId as string),
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'done' || status === 'failed' ? false : MEDIA_JOB_POLL_MS;
    },
  });
  const status = query.data?.status;
  useEffect(() => {
    if (status === 'done') invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return query;
}

/** PUT the original file to `incoming/` (XHR progress, abortable). */
export function useUploadRawLecture() {
  return useMutation({ mutationFn: uploadRawLecture, retry: 0 });
}

/** Create the audio-less draft + queue its compression. */
export function useCreateServerTranscodeLecture() {
  const invalidate = useInvalidateLectureLists();
  return useMutation({
    mutationFn: createServerTranscodeLecture,
    retry: 0,
    onSuccess: invalidate,
  });
}

/**
 * Re-queue a failed job with the same original (kept in `incoming/` after a
 * failure) and the same publish-on-done choice.
 */
export function useRetryLectureTranscode() {
  return useMutation({
    mutationFn: (vars: { lectureId: string; inputKey: string; publishOnDone: boolean }) =>
      enqueueLectureTranscode(vars.lectureId, vars.inputKey, vars.publishOnDone),
    retry: 0,
  });
}

/** Fire-and-forget cleanup of an uploaded-but-unsubmitted original. */
export function useDiscardRawUpload() {
  return useCallback((key: string) => {
    void discardRawUpload(key);
  }, []);
}
