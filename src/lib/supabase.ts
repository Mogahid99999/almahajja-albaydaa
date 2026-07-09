// URL polyfill must be imported before the supabase client on React Native.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/types/database';
import { env } from './env';

/**
 * The single Supabase client for the whole app.
 *
 * - Sessions are persisted with AsyncStorage (works on native and web).
 * - `detectSessionInUrl` is only enabled on web, where OAuth/magic-link
 *   redirects come back through the URL.
 *
 * Components must NOT import this directly — all data access goes through
 * `src/api/*` (see CLAUDE.md › Stack conventions).
 */
export const supabase = createClient<Database>(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  },
);

// React Native has no browser tab-visibility signal, which is what GoTrue
// normally uses to pause/resume its background refresh timer — left on its
// own on RN it keeps ticking while backgrounded and can fire a refresh right
// as the app foregrounds again too, racing the one that fires on init. That
// race is what used to wipe a perfectly valid session out of storage (see
// LAST_SESSION_KEY below). This is Supabase's documented RN fix: drive
// auto-refresh off AppState instead.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/**
 * Sidecar copy of whatever session — guest OR registered, unlike
 * `DEVICE_GUEST_KEY` in src/api/auth.ts, which is anonymous-only — was most
 * recently valid on this device. GoTrue can wipe its own primary storage
 * entry on a failed token refresh (a rotation race, or a transient/offline
 * error right at cold start — most commonly right after an app update, when
 * the JS process restarts fresh and immediately needs to refresh an expired
 * token) even though the session itself was still fine. `ensureSession()`
 * uses this to recover the account instead of silently minting a new
 * anonymous guest and orphaning the user's progress — i.e. "logged out after
 * updating the app".
 *
 * Kept fresh passively here on every event that carries a session
 * (SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION) and never pruned — a
 * stale/revoked entry just fails `setSession()` harmlessly and the caller
 * falls through to the next recovery step.
 */
export const LAST_SESSION_KEY = 'sb-last-known-session';

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) return;
  void AsyncStorage.setItem(
    LAST_SESSION_KEY,
    JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
  ).catch(() => {});
});
