import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCurrentUser,
  requestPasswordReset,
  signIn,
  signOut,
} from '@/api/auth';
import { queryKeys } from '@/constants/queryKeys';

/** Current signed-in user (with role). `null` when signed out. */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    staleTime: Infinity,
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      signIn(vars.email, vars.password),
    onSuccess: (user) => qc.setQueryData(queryKeys.currentUser, user),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      qc.setQueryData(queryKeys.currentUser, null);
      qc.clear();
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
  });
}
