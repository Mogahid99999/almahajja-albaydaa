import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import {
  changePassword,
  changePhone,
  deleteAccount,
  ensureSession,
  getCurrentUser,
  register,
  requestEmailChange,
  requestPasswordReset,
  signIn,
  signOut,
  updateProfile,
  verifyEmailChange,
} from '@/api/auth';
import type { CurrentUser } from '@/api/auth';
import { unregisterPushToken } from '@/api/notifications';
import type { Gender, HomeData } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';
import { stop as stopPlayback } from '@/lib/audioController';
import { cancelAllLocalNotifications } from '@/lib/notifications';
import { clearOutbox } from '@/lib/outbox';
import { queryClient } from '@/lib/queryClient';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTourStore } from '@/stores/tourStore';

/**
 * Shared cleanup for BOTH sign-out and account deletion: whatever the
 * outgoing account left running on this device must not survive it —
 * otherwise the next user (a guest, or someone else on a shared device)
 * inherits audio still playing in the background and reminders/badges that
 * were scheduled off the outgoing account's own progress/prefs. Runs before
 * the session actually drops, so nothing here depends on the old session
 * still being valid except `unregisterToken` (handled separately, see
 * useSignOut) — this part is pure device-local cleanup.
 */
async function stopDeviceSideEffects(): Promise<void> {
  stopPlayback();
  await cancelAllLocalNotifications();
  // Outbox entries carry no user id — anything still queued would replay under
  // the NEXT identity's session (guest, or another user on a shared device),
  // writing the outgoing account's private notes / listening ticks into someone
  // else's rows. Identity boundaries discard un-synced offline writes (audit
  // phase 3 — see clearQueue's doc comment in outboxQueue.ts).
  await clearOutbox();
  // Force the NEXT signed-in/guest session to register its own push token
  // rather than silently skipping it (NotificationsBootstrap only registers
  // once per JS run via this `registered` flag).
  useNotificationsStore.getState().setRegistered(false);
}

/**
 * Cleanup for a FORCED session drop (ban / server-side account deletion,
 * detected by `checkBannedAndSignOut` on app-foreground). Mirrors what
 * useSignOut does for a voluntary sign-out — stop audio + local reminders,
 * drop the outgoing account's outbox, and reset the query cache so none of the
 * banned account's data keeps rendering under the restored guest session. The
 * push-token row can't be unregistered here (the banned session's requests are
 * already rejected server-side); the server must stop pushing to banned
 * accounts on its own (Phase 2/9 concern).
 */
export async function forcedSignOutCleanup(nextUser: CurrentUser | null): Promise<void> {
  await stopDeviceSideEffects();
  queryClient.clear();
  queryClient.setQueryData(queryKeys.currentUser, nextUser);
}

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

/** `identifier` is either an email or a phone number — see `signIn`'s doc comment. */
export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    // The whole account switch lives in mutationFn (mirrors useSignOut): the
    // device guest's cached queries (Home resume card, section progress, notes)
    // and its un-synced outbox must NOT carry into the signed-in account —
    // without the clear they keep serving the guest's data for up to a full
    // staleTime (30 min), and queued guest writes would replay under the new
    // account's uid. Order matters: outbox first (its entries are the guest's),
    // then the cache reset, then the fresh user primed before any refetch.
    mutationFn: async (vars: { identifier: string; password: string }) => {
      const user = await signIn(vars.identifier, vars.password);
      await clearOutbox();
      qc.clear();
      qc.setQueryData(queryKeys.currentUser, user);
      return user;
    },
  });
}

/** Register: link name+phone(+optional email)+password+gender onto the current anon account. */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      name: string;
      phone: string;
      email: string;
      password: string;
      gender: Gender;
    }) => register(vars.name, vars.phone, vars.email, vars.password, vars.gender),
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

      // First-time "How it works" tour (TourCard): starts once, right here,
      // right after registration — see tourStore for why this is in-session
      // only rather than a persisted account flag. suggestStartHere makes the
      // «ابدأ من هنا» recommendation (StartHereCard) follow this tour's end —
      // registration tours only, not the الحساب replay.
      const home = qc.getQueryData<HomeData>(queryKeys.home);
      useTourStore.getState().start(
        {
          sectionId: home?.sections[0]?.id ?? null,
          lectureId:
            home?.continueListening?.id ?? home?.newlyAdded[0]?.id ?? home?.featured[0]?.id ?? null,
        },
        { suggestStartHere: true },
      );
    },
  });
}

/** Edit display name / gender of the signed-in account (Task 2 / 26.2). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: { displayName?: string; gender?: Gender }) => updateProfile(fields),
    onSuccess: (user) => qc.setQueryData(queryKeys.currentUser, user),
  });
}

/** Step 1 of the two-step email add/change — sends a code to the new address. */
export function useRequestEmailChange() {
  return useMutation({
    mutationFn: (email: string) => requestEmailChange(email),
  });
}

/** Step 2 — verify the code, completing the email change. */
export function useVerifyEmailChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; code: string }) => verifyEmailChange(vars.email, vars.code),
    onSuccess: (user) => qc.setQueryData(queryKeys.currentUser, user),
  });
}

/** Change password for the signed-in user — requires the current password. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      changePassword(vars.currentPassword, vars.newPassword),
  });
}

/** Self-service phone change — instant, no OTP (mirrors admin's phone edit). */
export function useChangePhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) => changePhone(phone),
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
      // Drop this device's push-token row for the OUTGOING account BEFORE the
      // session clears (it needs the still-valid session to identify whose
      // row to delete) — otherwise that account keeps receiving its pushes on
      // this device forever, looking like "notifications still work after
      // logging out".
      const deviceToken = useNotificationsStore.getState().token;
      if (deviceToken) await unregisterPushToken(deviceToken);
      await stopDeviceSideEffects();
      const restored = await signOut();
      const guest =
        restored ??
        (Platform.OS === 'web' ? null : await ensureSession().catch(() => null));
      qc.clear();
      qc.setQueryData(queryKeys.currentUser, guest ?? null);
    },
  });
}

/**
 * Permanent in-app account deletion (App Store 5.1.1(v)). Mirrors useSignOut's
 * shape — everything in mutationFn so the cache reset survives the component
 * unmounting, and the guest session exists BEFORE qc.clear() for the same
 * stale-refetch reason documented there.
 */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Same device-local cleanup as useSignOut (audio + local reminders/badge).
      // The push-token ROW itself doesn't need an explicit delete here — the
      // delete-account Edge Function's cascade already removes it server-side.
      await stopDeviceSideEffects();
      const restored = await deleteAccount();
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
