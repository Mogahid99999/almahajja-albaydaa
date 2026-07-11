import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelBuddy,
  getAdminBuddyOverview,
  getMyBuddyStatus,
  getPendingIncomingRequests,
  hasOutgoingPendingRequest,
  respondToRequest,
  searchBuddyCandidates,
  sendBuddyRequest,
} from '@/api/buddy';
import { queryKeys } from '@/constants/queryKeys';

/** Admin-only رفيق الدراسة overview (counts + active pairs). */
export function useAdminBuddyOverview() {
  return useQuery({
    queryKey: queryKeys.adminBuddies,
    queryFn: getAdminBuddyOverview,
  });
}

/** Active buddy + status (null when none). Disabled for guests. */
export function useBuddy(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddy,
    queryFn: getMyBuddyStatus,
    enabled: options?.enabled ?? true,
  });
}

/** Incoming pending invitations. Disabled for guests. */
export function usePendingBuddyRequests(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddyRequests,
    queryFn: getPendingIncomingRequests,
    enabled: options?.enabled ?? true,
  });
}

/** Whether my own invitation is still pending ("طلبك قيد الانتظار"). */
export function useOutgoingPending(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddyOutgoing,
    queryFn: hasOutgoingPendingRequest,
    enabled: options?.enabled ?? true,
  });
}

/** Debounced same-gender candidate search. */
export function useBuddySearch(query: string) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  return useQuery({
    queryKey: queryKeys.buddySearch(debounced),
    queryFn: () => searchBuddyCandidates(debounced),
  });
}

function useInvalidateBuddy() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['buddy'] });
  };
}

export function useSendBuddyRequest() {
  const invalidate = useInvalidateBuddy();
  return useMutation({
    mutationFn: (toUserId: string) => sendBuddyRequest(toUserId),
    onSuccess: invalidate,
  });
}

export function useRespondToRequest() {
  const invalidate = useInvalidateBuddy();
  return useMutation({
    mutationFn: (vars: { requestId: string; accept: boolean }) =>
      respondToRequest(vars.requestId, vars.accept),
    onSuccess: invalidate,
  });
}

export function useCancelBuddy() {
  const invalidate = useInvalidateBuddy();
  return useMutation({
    mutationFn: cancelBuddy,
    onSuccess: invalidate,
  });
}
