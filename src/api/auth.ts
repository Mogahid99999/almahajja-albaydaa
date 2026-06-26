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
export type CurrentUser = { id: string; email: string; role: AppRole };

const MOCK_SESSION_KEY = 'mock-auth-session';

function roleForEmail(email: string): AppRole {
  return email.trim().toLowerCase() === DEMO_ACCOUNTS.admin.email ? 'admin' : 'student';
}

/** Currently signed-in user (with role), or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  }
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  const role = (u.user_metadata?.role as AppRole) ?? roleForEmail(u.email ?? '');
  return { id: u.id, email: u.email ?? '', role };
}

export async function signIn(email: string, password: string): Promise<CurrentUser> {
  const e = email.trim().toLowerCase();
  if (USE_MOCK) {
    const match = Object.values(DEMO_ACCOUNTS).find(
      (a) => a.email === e && a.password === password,
    );
    if (!match) throw new Error('بيانات الدخول غير صحيحة');
    const user: CurrentUser = { id: `mock-${match.role}`, email: e, role: match.role };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
  if (error) throw error;
  const u = data.user!;
  const role = (u.user_metadata?.role as AppRole) ?? roleForEmail(e);
  return { id: u.id, email: u.email ?? e, role };
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
