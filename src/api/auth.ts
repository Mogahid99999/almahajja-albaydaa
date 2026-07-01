/**
 * Auth + role.
 *
 * Sign-in is mocked while `USE_MOCK` is true (accepts the two demo accounts and
 * persists a local session), so emulator testing never blocks on email. Password
 * reset always hits REAL Supabase (`resetPasswordForEmail`) — the demo accounts
 * are seeded there (scripts/seed-auth.mjs) so the email actually sends.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

import { DEMO_ACCOUNTS, USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type AppRole = 'admin' | 'student';
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
 */
export type CurrentUser = {
  id: string;
  email: string;
  role: AppRole;
  isGuest: boolean;
  displayName: string | null;
};

const MOCK_SESSION_KEY = 'mock-auth-session';

function roleForEmail(email: string): AppRole {
  return email.trim().toLowerCase() === DEMO_ACCOUNTS.admin.email ? 'admin' : 'student';
}

/** Currently signed-in user (with role), or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as CurrentUser;
    return { ...u, isGuest: u.isGuest ?? false, displayName: u.displayName ?? null };
  }
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  const role = (u.user_metadata?.role as AppRole) ?? roleForEmail(u.email ?? '');
  return {
    id: u.id,
    email: u.email ?? '',
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
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
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  const u = data.user!;
  return { id: u.id, email: u.email ?? '', role: 'student', isGuest: true, displayName: null };
}

export async function signIn(email: string, password: string): Promise<CurrentUser> {
  const e = email.trim().toLowerCase();
  if (USE_MOCK) {
    const match = Object.values(DEMO_ACCOUNTS).find(
      (a) => a.email === e && a.password === password,
    );
    if (!match) throw new Error('بيانات الدخول غير صحيحة');
    const user: CurrentUser = {
      id: `mock-${match.role}`,
      email: e,
      role: match.role,
      isGuest: false,
      displayName: null,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
  if (error) throw error;
  const u = data.user!;
  const role = (u.user_metadata?.role as AppRole) ?? roleForEmail(e);
  return {
    id: u.id,
    email: u.email ?? e,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
  };
}

/**
 * Register (Task 2): link name + email + password onto the CURRENT anonymous
 * account so no progress is lost — same auth uid, so all `user_lecture_progress`
 * rows carry over and start syncing across devices. `is_anonymous` flips to false
 * immediately (email confirmation is disabled on the project), so رحلتي العلمية
 * unlocks right away. Data-minimisation: only name + email are collected.
 */
export async function register(
  name: string,
  email: string,
  password: string,
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
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.updateUser({
    email: e,
    password,
    data: { display_name: display },
  });
  if (error) throw error;
  const u = data.user;
  const role = (u.user_metadata?.role as AppRole) ?? roleForEmail(e);
  return {
    id: u.id,
    email: u.email ?? e,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) || display || null,
  };
}

/**
 * Edit the profile (Task 2): update the display name and/or email of the signed-in
 * account. Name lives in `user_metadata`; email uses Supabase's email-change flow.
 */
export async function updateProfile(fields: {
  displayName?: string;
  email?: string;
}): Promise<CurrentUser> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    const cur = raw ? (JSON.parse(raw) as CurrentUser) : null;
    if (!cur) throw new Error('لا يوجد حساب');
    const next: CurrentUser = {
      ...cur,
      displayName: fields.displayName !== undefined ? fields.displayName.trim() || null : cur.displayName,
      email: fields.email !== undefined ? fields.email.trim().toLowerCase() : cur.email,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(next));
    return next;
  }
  const payload: Parameters<typeof supabase.auth.updateUser>[0] = {};
  if (fields.email !== undefined) payload.email = fields.email.trim().toLowerCase();
  if (fields.displayName !== undefined) payload.data = { display_name: fields.displayName.trim() };
  const { data, error } = await supabase.auth.updateUser(payload);
  if (error) throw error;
  const u = data.user;
  const role = (u.user_metadata?.role as AppRole) ?? roleForEmail(u.email ?? '');
  return {
    id: u.id,
    email: u.email ?? '',
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
  };
}

export async function signOut(): Promise<void> {
  if (USE_MOCK) {
    await AsyncStorage.removeItem(MOCK_SESSION_KEY);
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Send a password-reset email (always real Supabase). */
export async function requestPasswordReset(email: string): Promise<void> {
  const redirectTo = Linking.createURL('/reset-password');
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  });
  if (error) throw error;
}

/** Set a new password after following the reset link (real Supabase session). */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
