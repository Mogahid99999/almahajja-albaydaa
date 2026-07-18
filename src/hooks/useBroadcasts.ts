import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  getBroadcastImageUrl,
  getHomeBroadcasts,
  listBroadcasts,
  updateBroadcast,
  uploadBroadcastAudio,
  uploadBroadcastImage,
  type BroadcastInput,
} from '@/api/broadcasts';
import type { PickedFile } from '@/api/storage';
import { queryKeys } from '@/constants/queryKeys';

/** Admin/publisher list of every broadcast, newest first. */
export function useAdminBroadcasts() {
  return useQuery({
    queryKey: queryKeys.adminBroadcasts,
    queryFn: listBroadcasts,
  });
}

/** Active Home cards (server 1-day window). Admin creation already invalidates this. */
export function useHomeBroadcasts() {
  return useQuery({
    queryKey: queryKeys.homeBroadcasts,
    queryFn: getHomeBroadcasts,
    staleTime: 5 * 60_000,
  });
}

/** One broadcast for the detail page (null = deleted/unknown). */
export function useBroadcast(id: string) {
  return useQuery({
    queryKey: queryKeys.broadcast(id),
    queryFn: () => getBroadcast(id),
    enabled: !!id,
  });
}

function useInvalidateBroadcasts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.adminBroadcasts });
    void qc.invalidateQueries({ queryKey: queryKeys.homeBroadcasts });
    void qc.invalidateQueries({ queryKey: ['broadcasts'] });
  };
}

export function useCreateBroadcast() {
  const invalidate = useInvalidateBroadcasts();
  return useMutation({
    mutationFn: (input: BroadcastInput) => createBroadcast(input),
    onSuccess: invalidate,
  });
}

export function useUpdateBroadcast() {
  const invalidate = useInvalidateBroadcasts();
  return useMutation({
    mutationFn: (vars: { id: string; input: BroadcastInput }) =>
      updateBroadcast(vars.id, vars.input),
    onSuccess: invalidate,
  });
}

export function useDeleteBroadcast() {
  const invalidate = useInvalidateBroadcasts();
  return useMutation({
    mutationFn: (id: string) => deleteBroadcast(id),
    onSuccess: invalidate,
  });
}

/** Upload a reminder image (admin form) — returns the R2 object key. */
export function useUploadBroadcastImage() {
  return useMutation({
    mutationFn: (file: PickedFile) => uploadBroadcastImage(file),
  });
}

/** Upload a reminder audio clip (admin form) — returns the R2 object key. */
export function useUploadBroadcastAudio() {
  return useMutation({
    mutationFn: (file: PickedFile) => uploadBroadcastAudio(file),
  });
}

/** Resolve an existing reminder's image key to a signed preview URL (edit mode). */
export function useBroadcastImageUrl(imagePath: string | null) {
  return useQuery({
    queryKey: ['broadcastImageUrl', imagePath],
    queryFn: () => getBroadcastImageUrl(imagePath as string),
    enabled: !!imagePath,
    staleTime: 30 * 60_000,
  });
}
