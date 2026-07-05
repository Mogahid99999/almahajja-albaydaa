import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import {
  ensureSession,
  getCurrentUser,
  register,
  requestPasswordReset,
  signIn,
  signOut,
  updateProfile,
} from '@/api/auth';
import type { Gender } from '@/api/types';
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

/** Register: link name+email+password+gender onto the current anon account (Task 2 / 26.2). */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; email: string; password: string; gender: Gender }) =>
      register(vars.name, vars.email, vars.password, vars.gender),
    onSuccess: (user) => {
      qc.setQueryData(queryKeys.currentUser, user);
      // Phase 3.6 safety net: `register()` links onto the SAME auth.uid() (no new
      // user id, no row migration needed — `user_lecture_progress` already belongs
      // to this uid before and after), so there is nothing to "carry over" here.
      // But if any pre-registration completion is still sitting in a stale
      // `home`/`section` cache entry (e.g. a still-mounted screen that missed an
      // earlier invalidation, or an outbox replay that raced the sign-up request),
      // registering is a natural moment to force a resync so رحلتي العلمية and the
      // section the student was just in never show a percentage that regresses.
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      void qc.invalidateQueries({ queryKey: ['section'] });
      void qc.invalidateQueries({ queryKey: ['journey'] });
    },
  });
}

/** Edit display name / email / gender of the signed-in account (Task 2 / 26.2). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: { displayName?: string; email?: string; gender?: Gender }) =>
      updateProfile(fields),
    onSuccess: (user) => qc.setQueryData(queryKeys.currentUser, user),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    // Guest-first: signing out drops the registered session and returns to the
    // DEVICE guest (signOut restores it; a brand-new anon user is created only
    // when there is nothing to restore) so إجمالي الطلاب isn't inflated by
    // sign-out cycles. Web (staff dashboard) never gets a guest session.
    // Everything lives in mutationFn ON PURPOSE: observer callbacks (onSettled)
    // die with the component, and the admin drawer unmounts its button when it
    // closes — the cache reset must survive that. Order also matters: the guest
    // session must exist BEFORE qc.clear(), otherwise a refetch triggered by the
    // clear reads the dying session and writes the stale user back into the cache.
    mutationFn: async () => {
      const restored = await signOut();
      const guest =
        restored ??
        (Platform.OS === 'web' ? null : await ensureSession().catch(() => null));
      qc.clear();
      qc.setQueryData(queryKeys.currentUser, guest ?? null);
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
  });
}
