/**
 * Auth + role.
 *
 * Sign-in is mocked while `USE_MOCK` is true (accepts the two demo accounts and
 * persists a local session), so emulator testing never blocks on email. Password
 * reset always hits REAL Supabase (`resetPasswordForEmail`) — the demo accounts
 * are seeded there (scripts/seed-auth.mjs) so the email actually sends.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { DEMO_ACCOUNTS, USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { Gender } from './types';

export type AppRole = 'admin' | 'student' | 'publisher' | 'sheikh';
/**
 * `isGuest` is true for the silent anonymous account every install gets on boot
 * (Supabase anonymous sign-in). It flips to false the moment the user registers
 * (name+email+password linked onto the SAME account — no progress lost). Only
 * رحلتي العلمية is gated on it; browsing/playback/downloads/notifications stay open.
 *
 * `displayName` is the الاسم shown across the app (not the email). It lives in the
 * auth user's `user_metadata` — user-owned, updatable via `updateUser`, and synced
 * across devices — so no extra query and no `profiles` RLS write is needed (the
 * `profiles` table only permits admin writes).
 *
 * `gender` (26.2) is read from the same metadata for instant client access, but
 * the authoritative copy lives in `profiles.gender` (written via the
 * set_own_profile SECURITY DEFINER RPC) — the buddy SQL enforces the gender
 * segregation server-side against profiles, never against metadata.
 */
export type CurrentUser = {
  id: string;
  email: string;
  role: AppRole;
  isGuest: boolean;
  displayName: string | null;
  gender: Gender | null;
};

/**
 * Sync gender/name into `profiles` (SECURITY DEFINER; students may set only
 * these two columns). Best-effort — an auth update must never fail on it; the
 * next profile save retries the sync.
 */
async function syncOwnProfile(fields: {
  gender?: Gender;
  displayName?: string;
  oathAccepted?: boolean;
}): Promise<void> {
  try {
    await supabase.rpc('set_own_profile', {
      ...(fields.gender ? { p_gender: fields.gender } : {}),
      ...(fields.displayName ? { p_display_name: fields.displayName } : {}),
      ...(fields.oathAccepted ? { p_oath_accepted: true } : {}),
    });
  } catch {
    // Non-fatal.
  }
}

const MOCK_SESSION_KEY = 'mock-auth-session';

/**
 * Device-bound guest (V6 fix): ONE anonymous account per device, ever. Signing
 * out of a registered account used to mint a brand-new anonymous user each
 * time, silently inflating إجمالي الطلاب with phantom "new users". Instead the
 * guest session's tokens are kept here and RESTORED on sign-out, so the same
 * anon uid serves the device for life (cleared only when that uid upgrades to
 * a real account via register, or on reinstall).
 */
const DEVICE_GUEST_KEY = 'device-guest-session';

type StoredGuestSession = { access_token: string; refresh_token: string };

async function storeGuestSession(session: {
  access_token: string;
  refresh_token: string;
} | null): Promise<void> {
  try {
    if (!session) return;
    await AsyncStorage.setItem(
      DEVICE_GUEST_KEY,
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    );
  } catch {
    // Best-effort — worst case a new guest is created on the next sign-out.
  }
}

async function clearStoredGuestSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEVICE_GUEST_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Bring the device's guest session back after a sign-out. Returns false when
 * there is nothing valid to restore (caller then creates a fresh guest).
 * SAFETY: if the stored uid has since become a REGISTERED account (register()
 * links in place), restoring it would silently log the user back in — so a
 * non-anonymous restore is discarded and the session dropped again.
 */
async function restoreGuestSession(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_GUEST_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as StoredGuestSession;
    const { data, error } = await supabase.auth.setSession(stored);
    if (error || !data.session || !data.user) {
      await clearStoredGuestSession();
      return false;
    }
    if (!(data.user.is_anonymous ?? false)) {
      await clearStoredGuestSession();
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return false;
    }
    // setSession rotates the tokens — keep the fresh pair for the next cycle.
    await storeGuestSession(data.session);
    return true;
  } catch {
    return false;
  }
}

// Real accounts (seed scripts, admin-users edge function) always write `role`
// into user_metadata, so this only ever fires for an account created without
// it — safe to default to the least-privileged role.
function fallbackRole(): AppRole {
  return 'student';
}

/** Currently signed-in user (with role), or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as CurrentUser;
    return {
      ...u,
      isGuest: u.isGuest ?? false,
      displayName: u.displayName ?? null,
      gender: u.gender ?? null,
    };
  }
  // getSession() reads the session from async-storage WITHOUT a network round-trip
  // (unlike getUser(), which validates against the auth server). This is what
  // makes an offline cold start reach Home from the cached session instead of
  // hanging on a network call the device can't complete (V10 Feature D).
  const { data } = await supabase.auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? '',
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
    gender: (u.user_metadata?.gender as Gender) ?? null,
  };
}

/**
 * Guest-first foundation (Task 1). Sign in silently as an anonymous user so every
 * install has a session — Home opens for anyone, and resume/downloads/notifications
 * work because there's a hidden account behind them. The Supabase trigger
 * `handle_new_user` gives the anon uid a `profiles` row (role student), so the
 * new-content fan-out already reaches guests. No-op if a session already exists.
 */
export async function ensureSession(): Promise<CurrentUser | null> {
  const existing = await getCurrentUser();
  if (existing) return existing;
  return signInAnonymously();
}

/** Create the silent anonymous session (or a mock guest in mock mode). */
export async function signInAnonymously(): Promise<CurrentUser> {
  if (USE_MOCK) {
    const user: CurrentUser = {
      id: 'mock-guest',
      email: '',
      role: 'student',
      isGuest: true,
      displayName: null,
      gender: null,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  await storeGuestSession(data.session);
  const u = data.user!;
  return {
    id: u.id,
    email: u.email ?? '',
    role: 'student',
    isGuest: true,
    displayName: null,
    gender: null,
  };
}

export async function signIn(email: string, password: string): Promise<CurrentUser> {
  const e = email.trim().toLowerCase();
  if (USE_MOCK) {
    const match = Object.values(DEMO_ACCOUNTS!).find(
      (a) => a.email === e && a.password === password,
    );
    if (!match) throw new Error('بيانات الدخول غير صحيحة');
    const user: CurrentUser = {
      id: `mock-${match.role}`,
      email: e,
      role: match.role,
      isGuest: false,
      displayName: null,
      gender: null,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  // Capture the guest session's live tokens before it is replaced, so signing
  // out later returns to the SAME device guest instead of minting a new one.
  const { data: pre } = await supabase.auth.getSession();
  if (pre.session && (pre.session.user.is_anonymous ?? false)) {
    await storeGuestSession(pre.session);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
  if (error) throw error;
  const u = data.user!;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? e,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
    gender: (u.user_metadata?.gender as Gender) ?? null,
  };
}

/**
 * Register (Task 2): link name + email + password onto the CURRENT anonymous
 * account so no progress is lost — same auth uid, so all `user_lecture_progress`
 * rows carry over and start syncing across devices. `is_anonymous` flips to false
 * immediately (email confirmation is disabled on the project), so رحلتي العلمية
 * unlocks right away. Data-minimisation: only name + email + gender (26.2 —
 * required for the gender-segregated study buddy) are collected.
 */
export async function register(
  name: string,
  email: string,
  password: string,
  gender: Gender,
): Promise<CurrentUser> {
  const e = email.trim().toLowerCase();
  const display = name.trim();
  if (USE_MOCK) {
    const user: CurrentUser = {
      id: 'mock-guest',
      email: e,
      role: 'student',
      isGuest: false,
      displayName: display || null,
      gender,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.updateUser({
    email: e,
    password,
    data: { display_name: display, gender },
  });
  if (error) throw error;
  // This uid is no longer a guest — restoring its stored tokens after a
  // sign-out would silently log back into the registered account.
  await clearStoredGuestSession();
  await syncOwnProfile({ gender, displayName: display, oathAccepted: true });
  const u = data.user;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? e,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) || display || null,
    gender: (u.user_metadata?.gender as Gender) ?? gender,
  };
}

/**
 * Edit the profile (Task 2): update the display name, email, and/or gender of
 * the signed-in account. Name + gender live in `user_metadata` (and are synced
 * into `profiles` for the buddy SQL); email uses Supabase's email-change flow.
 */
export async function updateProfile(fields: {
  displayName?: string;
  email?: string;
  gender?: Gender;
}): Promise<CurrentUser> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    const cur = raw ? (JSON.parse(raw) as CurrentUser) : null;
    if (!cur) throw new Error('لا يوجد حساب');
    const next: CurrentUser = {
      ...cur,
      displayName: fields.displayName !== undefined ? fields.displayName.trim() || null : cur.displayName,
      email: fields.email !== undefined ? fields.email.trim().toLowerCase() : cur.email,
      gender: fields.gender ?? cur.gender,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(next));
    return next;
  }
  const payload: Parameters<typeof supabase.auth.updateUser>[0] = {};
  if (fields.email !== undefined) payload.email = fields.email.trim().toLowerCase();
  const meta: Record<string, string> = {};
  if (fields.displayName !== undefined) meta.display_name = fields.displayName.trim();
  if (fields.gender !== undefined) meta.gender = fields.gender;
  if (Object.keys(meta).length) payload.data = meta;
  const { data, error } = await supabase.auth.updateUser(payload);
  if (error) throw error;
  if (fields.displayName !== undefined || fields.gender !== undefined) {
    await syncOwnProfile({ gender: fields.gender, displayName: fields.displayName });
  }
  const u = data.user;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? '',
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
    gender: (u.user_metadata?.gender as Gender) ?? null,
  };
}

/**
 * Sign out of the registered account and (on native) return to the device's
 * guest session. Restoring — instead of creating a new anonymous user every
 * time — keeps إجمالي الطلاب honest: one guest per device, ever.
 * Returns the restored guest, or null when there is none (web, or nothing to
 * restore — the caller then boots a fresh guest via ensureSession).
 */
export async function signOut(): Promise<CurrentUser | null> {
  if (USE_MOCK) {
    await AsyncStorage.removeItem(MOCK_SESSION_KEY);
    return null;
  }
  // The global sign-out revokes server-side but fails on a network hiccup or a
  // stale refresh token — which used to leave the button visibly dead. Fall
  // back to clearing the LOCAL session so signing out always takes effect.
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  // Web is the staff dashboard — no guest sessions there.
  if (Platform.OS === 'web') return null;
  const restored = await restoreGuestSession();
  if (!restored) return null;
  return getCurrentUser();
}

/**
 * Permanently delete the signed-in account (App Store Guideline 5.1.1(v)).
 * The `delete-account` Edge Function verifies the caller's JWT and removes
 * their own auth.users row with the service role — every personal table
 * cascades off it (see the function header), so progress, notes, prefs,
 * push tokens and the rest go with the account in one server-side delete.
 * Afterwards the dead session is dropped locally and (on native) the device's
 * guest session is restored, mirroring {@link signOut} — the app keeps working
 * as a guest. Returns the restored guest, or null when a fresh one is needed.
 */
export async function deleteAccount(): Promise<CurrentUser | null> {
  if (USE_MOCK) {
    await AsyncStorage.removeItem(MOCK_SESSION_KEY);
    return null;
  }
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;
  // The account no longer exists server-side — only a local sign-out applies.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  if (Platform.OS === 'web') return null;
  const restored = await restoreGuestSession();
  if (!restored) return null;
  return getCurrentUser();
}

/**
 * Send a password-reset email (always real Supabase). The recovery email is an
 * OTP CODE, not a link (Supabase recovery template renders `{{ .Token }}`), so
 * the flow is identical on native and web — no deep link / recovery redirect.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
  if (error) throw error;
}

/**
 * Verify the 6-digit code from the reset email. On success Supabase establishes
 * a short-lived recovery session for that account, which updatePassword then
 * writes against.
 */
export async function verifyPasswordResetCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'recovery',
  });
  if (error) throw error;
}

/** Set a new password (runs against the recovery session from verifyOtp). */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
