import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ensureSession,
  getCurrentUser,
  register,
  requestPasswordReset,
  signIn,
  signOut,
  updateProfile,
} from '@/api/auth';
import { queryKeys } from '@/constants/queryKeys';

/** Current signed-in user (with role + isGuest). `null` only before the anon session boots. */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    staleTime: Infinity,
  });
}

/**
 * Guest-first boot: make sure a session exists (silent anonymous sign-in when
 * there is none), then prime the currentUser cache. Called once on app boot so
 * Home is the entry point for everyone — no login gate.
 */
export function useEnsureSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ensureSession,
    onSuccess: (user) => {
      if (user) qc.setQueryData(queryKeys.currentUser, user);
    },
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

/** Register: link name+email+password onto the current anon account (Task 2). */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; email: string; password: string }) =>
      register(vars.name, vars.email, vars.password),
    onSuccess: (user) => qc.setQueryData(queryKeys.currentUser, user),
  });
}

/** Edit display name and/or email of the signed-in account (Task 2). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: { displayName?: string; email?: string }) => updateProfile(fields),
    onSuccess: (user) => qc.setQueryData(queryKeys.currentUser, user),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    // Guest-first: signing out drops the registered session and immediately boots
    // a fresh anonymous one, so the app stays usable (browse as a guest) instead
    // of landing on a dead null-session state.
    onSuccess: async () => {
      qc.clear();
      const guest = await ensureSession();
      qc.setQueryData(queryKeys.currentUser, guest ?? null);
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
  });
}
