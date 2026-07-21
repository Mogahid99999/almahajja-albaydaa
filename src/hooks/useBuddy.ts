import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminEndBuddyPair,
  cancelBuddy,
  cancelBuddyRequest,
  getAdminBuddyOverview,
  getMyBuddies,
  getMyBuddyStatus,
  getOutgoingRequests,
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

/** Admin-only: end an active pairing between two students, then refresh the overview. */
export function useAdminEndBuddyPair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { aId: string; bId: string }) => adminEndBuddyPair(vars.aId, vars.bId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.adminBuddies });
      // The two students' own buddy cards should refresh too if mounted.
      void qc.invalidateQueries({ queryKey: ['buddy'], refetchType: 'all' });
    },
  });
}

/** Active buddy + status (first buddy, null when none). Disabled for guests. */
export function useBuddy(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddy,
    queryFn: getMyBuddyStatus,
    enabled: options?.enabled ?? true,
  });
}

/** All accepted buddies (up to 3). Disabled for guests. */
export function useMyBuddies(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddies,
    queryFn: getMyBuddies,
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

/** My pending outgoing invitations (with invitee names) — for withdraw UI. */
export function useOutgoingRequests(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.buddyOutgoingList,
    queryFn: getOutgoingRequests,
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
  // refetchType 'all' so a buddy query that isn't currently mounted (e.g. the
  // Home card while we're on another screen) still refetches, instead of serving
  // stale cache until the next restart.
  return () => {
    void qc.invalidateQueries({ queryKey: ['buddy'], refetchType: 'all' });
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
    mutationFn: (buddyId?: string) => cancelBuddy(buddyId),
    onSuccess: invalidate,
  });
}

/** Withdraw one of my pending outgoing invitations. */
export function useCancelBuddyRequest() {
  const invalidate = useInvalidateBuddy();
  return useMutation({
    mutationFn: (requestId: string) => cancelBuddyRequest(requestId),
    onSuccess: invalidate,
  });
}
