// URL polyfill must be imported before the supabase client on React Native.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/types/database';
import { env } from './env';
import { dbBreaker, isServerFailureStatus, ServerBusyError } from './serverBreaker';

/**
 * Hard ceiling on a single auth (GoTrue) or database (PostgREST) request.
 * React Native's fetch has NO timeout on Android, so on a weak mobile signal a
 * request can hang forever — registration sat on «جارٍ التسجيل…» indefinitely
 * and never reached the server (reported 2026-09-27). Worse, a hung token
 * refresh is single-flighted inside supabase-js, so every later call that
 * needs the session waits on it too. PostgREST statements are already capped
 * at 8 s server-side, so 30 s never cuts off legitimate work. An aborted auth
 * fetch surfaces as a *retryable* error in auth-js, so the stored session is
 * kept (never wiped). Edge functions are left unbounded here — backup-media /
 * admin-users can legitimately run long; callers bound their own.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

function isBoundedRequest(url: string): boolean {
  return url.includes('/auth/v1/') || url.includes('/rest/v1/');
}

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!isBoundedRequest(url)) return fetch(input, init);
  // LOAD V24: database reads/writes pause briefly while the server is failing
  // (src/lib/serverBreaker.ts) instead of piling onto it. Auth is never gated.
  const gated = url.includes('/rest/v1/');
  if (gated && !dbBreaker.allow(Date.now())) return Promise.reject(new ServerBusyError());
  const controller = new AbortController();
  // Respect a caller's own AbortSignal (e.g. React Query cancellation).
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), ms);
  const req = fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!gated) return req;
  return req.then(
    (res) => {
      if (isServerFailureStatus(res.status)) dbBreaker.onFailure(Date.now());
      else dbBreaker.onSuccess();
      return res;
    },
    (err: unknown) => {
      // A caller's own cancellation says nothing about the server.
      if (!outer?.aborted) dbBreaker.onFailure(Date.now());
      throw err;
    },
  );
}

/**
 * The single Supabase client for the whole app.
 *
 * - Sessions are persisted with AsyncStorage (works on native and web).
 * - `detectSessionInUrl` is only enabled on web, where OAuth/magic-link
 *   redirects come back through the URL.
 * - Every auth/database request is time-bounded (see fetchWithTimeout).
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
    global: { fetch: fetchWithTimeout },
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
