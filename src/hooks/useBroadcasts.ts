import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  getHomeBroadcasts,
  listBroadcasts,
  updateBroadcast,
  type BroadcastInput,
} from '@/api/broadcasts';
import { queryKeys } from '@/constants/queryKeys';

/** Admin/publisher list of every broadcast, newest first. */
export function useAdminBroadcasts() {
  return useQuery({
    queryKey: queryKeys.adminBroadcasts,
    queryFn: listBroadcasts,
  });
}

/** Active Home cards (server 1-day window). */
export function useHomeBroadcasts() {
  return useQuery({
    queryKey: queryKeys.homeBroadcasts,
    queryFn: getHomeBroadcasts,
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
