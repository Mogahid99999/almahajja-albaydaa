import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  getBroadcastImageUrl,
  getBroadcastRecipients,
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

/**
 * Debounced, paginated candidate list for the التذكيرات النافعة targeting picker.
 * `noEmail` / `notRegistered` filter the student pool server-side (0120).
 */
export function useBroadcastRecipients(
  search: string,
  noEmail: boolean,
  notRegistered: boolean,
  options?: { enabled?: boolean },
) {
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.broadcastRecipients(debounced, noEmail, notRegistered),
    queryFn: ({ pageParam }) =>
      getBroadcastRecipients(debounced, pageParam, noEmail, notRegistered),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
  return {
    ...query,
    items: query.data?.pages.flatMap((p) => p.items) ?? [],
    totalCount: query.data?.pages[0]?.totalCount ?? 0,
  };
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
