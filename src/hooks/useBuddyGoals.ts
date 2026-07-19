import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelBuddyGoal,
  createBuddyGoal,
  getBuddyGoals,
  getIncomingBuddyGoals,
  respondBuddyGoal,
} from '@/api/buddyGoals';
import { sendEncouragement } from '@/api/encouragement';
import { queryKeys } from '@/constants/queryKeys';

/** All my shared buddy goals with live progress (V20 · §10). Off for guests. */
export function useBuddyGoals(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddyGoals,
    queryFn: getBuddyGoals,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/** Incoming shared-goal invitations (for the invitations page). */
export function useIncomingBuddyGoals(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.incomingBuddyGoals,
    queryFn: getIncomingBuddyGoals,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

function useInvalidateBuddyGoals() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.buddyGoals });
    qc.invalidateQueries({ queryKey: queryKeys.incomingBuddyGoals });
  };
}

export function useCreateBuddyGoal() {
  const invalidate = useInvalidateBuddyGoals();
  return useMutation({ mutationFn: createBuddyGoal, onSuccess: invalidate });
}

export function useRespondBuddyGoal() {
  const invalidate = useInvalidateBuddyGoals();
  return useMutation({
    mutationFn: ({ goalId, accept }: { goalId: string; accept: boolean }) =>
      respondBuddyGoal(goalId, accept),
    onSuccess: invalidate,
  });
}

export function useCancelBuddyGoal() {
  const invalidate = useInvalidateBuddyGoals();
  return useMutation({ mutationFn: cancelBuddyGoal, onSuccess: invalidate });
}

/** Send a canned encouragement to a buddy (§14). */
export function useSendEncouragement() {
  return useMutation({
    mutationFn: ({ toUserId, phraseKey }: { toUserId: string; phraseKey: string }) =>
      sendEncouragement(toUserId, phraseKey),
  });
}
