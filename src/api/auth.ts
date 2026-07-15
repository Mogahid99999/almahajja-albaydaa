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
import { LAST_SESSION_KEY, supabase } from '@/lib/supabase';
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
  /** E.164-ish digits only (see {@link normalizePhone}), or null if never set. */
  phone: string | null;
  role: AppRole;
  isGuest: boolean;
  displayName: string | null;
  gender: Gender | null;
};

/**
 * Fallback country code used only where the UI has no country picker (sign-in's
 * combined email-or-phone field — see app/(auth)/sign-in.tsx) and a typed
 * number doesn't already carry one. Every OTHER phone entry point (register,
 * profile phone change, admin create/edit user) has a `PhoneInput` picker
 * (src/components/ui/PhoneInput.tsx) and passes its selection explicitly —
 * guessing the country from digit count/length alone was the bug: a 9-digit
 * Saudi number and a 9-digit Sudanese number are indistinguishable, so a
 * Saudi (or other non-Sudan) sign-up used to silently get "249" prepended to
 * the wrong number.
 */
const DEFAULT_COUNTRY_CODE = '249';

/**
 * Phone is a real sign-in credential (phone+password) but is NEVER OTP-verified
 * — the project has `sms_autoconfirm` on and no SMS provider configured, so
 * whatever the user types is accepted, just reshaped into valid E.164:
 * strip everything but digits, drop a local trunk "0" prefix if present, and
 * prepend `countryCode` unless the number is already long enough to plausibly
 * carry one (or already starts with it). "0912345678", "912345678", and
 * "+249 91 234 5678" all normalize to the same "249912345678".
 */
export function normalizePhone(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return digits;
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  if (local.startsWith(countryCode) || local.length > 9) return local;
  return countryCode + local;
}

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
 * Hard ceiling on a single auth network/lock operation. supabase-js serializes
 * every auth call behind an internal lock; if an in-flight auto-refresh (or a
 * racing getSession/onAuthStateChange) stalls on a flaky network while holding
 * that lock, the NEXT call (e.g. signInWithPassword) waits on it FOREVER — the
 * reported "«جارٍ الدخول…» hangs until I Force Stop, as if a previous account
 * never finished". Racing each such call against this timeout guarantees the
 * promise always settles, so the UI re-enables and the user can just retry
 * instead of force-stopping. Generous enough for a slow-but-working connection.
 */
const AUTH_OP_TIMEOUT_MS = 20_000;

/**
 * Reject with a clear Arabic error if `p` hasn't settled within `ms` — used to
 * bound auth calls that can otherwise hang on the GoTrue lock (see above). The
 * underlying operation isn't cancellable, but rejecting frees the UI; a retry
 * finds the lock released (the stalled holder eventually errors out) and works.
 */
function withAuthTimeout<T>(p: Promise<T>, ms = AUTH_OP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('تعذّر إكمال العملية، تحقّق من اتصالك وحاول مرة أخرى')),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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

/**
 * Recover ANY session (guest or registered) this device most recently held,
 * for when the primary GoTrue storage entry has gone missing — see
 * LAST_SESSION_KEY's doc comment in src/lib/supabase.ts for why that happens.
 * Unlike restoreGuestSession, a non-anonymous result is never rejected here:
 * this isn't "logging back in" from scratch, only reusing tokens the device
 * already legitimately held a moment ago — and setSession() itself rejects
 * anything the server no longer honors (revoked/expired), so there's nothing
 * extra to guard against.
 */
async function restoreLastKnownSession(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as StoredGuestSession;
    const { data, error } = await supabase.auth.setSession(stored);
    return !error && !!data.session && !!data.user;
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
      phone: u.phone ?? null,
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
    phone: u.phone ?? null,
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
  // No live session found. Before minting a BRAND-NEW anonymous user — which
  // would orphan the device's identity (guest OR a registered account) and
  // read to the user as "logged out after updating the app" — try to recover
  // it. The primary Supabase auth-token in storage can get wiped by a failed
  // token refresh (a rotation race, or a transient/offline error right at
  // cold start) even though the session itself was fine; two sidecar copies
  // exist to recover from that:
  //  1. LAST_SESSION_KEY — whatever session (guest or registered) was most
  //     recently valid on this device. Covers a registered account exactly
  //     as well as a guest, since it's just replaying tokens the device
  //     already held.
  //  2. DEVICE_GUEST_KEY — the device's dedicated anon identity, restored
  //     after a deliberate sign-out. Kept as a second try in case (1) is
  //     empty/stale but this device still has its guest sidecar.
  // Only a genuine first install (nothing to restore anywhere) falls through
  // to a new anonymous user.
  if (Platform.OS !== 'web') {
    const recovered = await restoreLastKnownSession();
    if (recovered) {
      const user = await getCurrentUser();
      if (user) return user;
    }
    const restored = await restoreGuestSession();
    if (restored) {
      const user = await getCurrentUser();
      if (user) return user;
    }
  }
  return signInAnonymously();
}

/** Create the silent anonymous session (or a mock guest in mock mode). */
export async function signInAnonymously(): Promise<CurrentUser> {
  if (USE_MOCK) {
    const user: CurrentUser = {
      id: 'mock-guest',
      email: '',
      phone: null,
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
    phone: u.phone ?? null,
    role: 'student',
    isGuest: true,
    displayName: null,
    gender: null,
  };
}

/**
 * Sign in with EITHER an email or a phone number + password — the two share one
 * "البريد الإلكتروني أو رقم الهاتف" field (Task: phone registration). An
 * identifier containing '@' is treated as an email; anything else is
 * normalized to digits and sent as `phone` (Supabase's `signInWithPassword`
 * accepts either field, mutually exclusive).
 */
export async function signIn(identifier: string, password: string): Promise<CurrentUser> {
  const raw = identifier.trim();
  const isEmail = raw.includes('@');
  const e = isEmail ? raw.toLowerCase() : '';
  if (USE_MOCK) {
    const match = Object.values(DEMO_ACCOUNTS!).find(
      (a) => a.email === e && a.password === password,
    );
    if (!match) throw new Error('بيانات الدخول غير صحيحة');
    const user: CurrentUser = {
      id: `mock-${match.role}`,
      email: e,
      phone: null,
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
  // Best-effort + bounded: a stalled getSession must not wedge sign-in.
  try {
    const { data: pre } = await withAuthTimeout(supabase.auth.getSession());
    if (pre.session && (pre.session.user.is_anonymous ?? false)) {
      await storeGuestSession(pre.session);
    }
  } catch {
    // Non-fatal — worst case a fresh guest is minted on the next sign-out.
  }
  // Bounded so a stuck GoTrue lock (a stalled auto-refresh holding it) can't
  // hang «جارٍ الدخول…» forever — on timeout this rejects and the button
  // re-enables for a retry instead of forcing the user to Force Stop the app.
  const { data, error } = await withAuthTimeout(
    supabase.auth.signInWithPassword(
      isEmail ? { email: e, password } : { phone: normalizePhone(raw), password },
    ),
  );
  if (error) throw error;
  const u = data.user!;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? e,
    phone: u.phone ?? null,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
    gender: (u.user_metadata?.gender as Gender) ?? null,
  };
}

/**
 * Register (Task 2, extended for phone registration): link name + phone
 * (required) + password onto the CURRENT anonymous account so no progress is
 * lost — same auth uid, so all `user_lecture_progress` rows carry over and
 * start syncing across devices. Email is now OPTIONAL — set in a second,
 * separate step so a missing/invalid email never blocks the phone+password
 * linking. `is_anonymous` flips to false immediately: phone confirmation is
 * disabled project-wide (`sms_autoconfirm`) so no OTP is ever sent for the
 * phone.
 *
 * Email OTP is DISABLED for now (was burning the free Resend quota — see
 * the `register-set-email` edge function below): setting the email straight
 * onto this already-linked account via the client `updateUser({ email })`
 * call is Supabase's "secure email CHANGE" flow (distinct from initial-signup
 * confirmation), which sends a confirmation code to the address with no step
 * in the UI that ever asks the user to enter it. The `register-set-email`
 * edge function sets the email via the service role instead
 * (`email_confirm: true`), so it's saved + visible in the admin panel
 * immediately without any mail being sent. To re-enable OTP verification,
 * restore the commented call below AND add a verify step to the register UI.
 */
export async function register(
  name: string,
  phone: string,
  countryCode: string,
  email: string,
  password: string,
  gender: Gender,
): Promise<CurrentUser> {
  const p = normalizePhone(phone, countryCode);
  const e = email.trim().toLowerCase();
  const display = name.trim();
  if (USE_MOCK) {
    const user: CurrentUser = {
      id: 'mock-guest',
      email: e,
      phone: p || null,
      role: 'student',
      isGuest: false,
      displayName: display || null,
      gender,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    return user;
  }
  const { data, error } = await supabase.auth.updateUser({
    phone: p,
    password,
    data: { display_name: display, gender },
  });
  if (error) throw error;
  let u = data.user;
  let savedEmail = '';
  if (e) {
    // Best-effort: registration must not fail because of the OPTIONAL email.
    // Only trust it as saved if this call actually succeeded — otherwise the
    // returned user must NOT claim an email that never made it to the server
    // (e.g. "already registered"), or the profile screen would show an email
    // that silently isn't there.
    //
    // DISABLED (see docstring above) — this direct client call sends a
    // confirmation-code email with no UI step to consume it:
    //   const emailResult = await supabase.auth.updateUser({ email: e }).catch(() => null);
    //   if (emailResult?.data.user) u = emailResult.data.user;
    //
    // Instead, set the email via the service role so it's saved without
    // sending any mail.
    const { error: emailErr } = await supabase.functions
      .invoke('register-set-email', { body: { email: e } })
      .then((r) => ({ error: r.error }))
      .catch((err) => ({ error: err as Error }));
    if (!emailErr) savedEmail = e;
  }
  // This uid is no longer a guest — restoring its stored tokens after a
  // sign-out would silently log back into the registered account.
  await clearStoredGuestSession();
  await syncOwnProfile({ gender, displayName: display, oathAccepted: true });
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: savedEmail || u.email || '',
    phone: u.phone ?? p,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) || display || null,
    gender: (u.user_metadata?.gender as Gender) ?? gender,
  };
}

/**
 * Edit the profile (Task 2): update the display name and/or gender of the
 * signed-in account (both live in `user_metadata`, synced into `profiles` for
 * the buddy SQL). Email is NOT handled here — see {@link requestEmailChange}.
 */
export async function updateProfile(fields: {
  displayName?: string;
  gender?: Gender;
}): Promise<CurrentUser> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    const cur = raw ? (JSON.parse(raw) as CurrentUser) : null;
    if (!cur) throw new Error('لا يوجد حساب');
    const next: CurrentUser = {
      ...cur,
      displayName: fields.displayName !== undefined ? fields.displayName.trim() || null : cur.displayName,
      gender: fields.gender ?? cur.gender,
    };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(next));
    return next;
  }
  const meta: Record<string, string> = {};
  if (fields.displayName !== undefined) meta.display_name = fields.displayName.trim();
  if (fields.gender !== undefined) meta.gender = fields.gender;
  const { data, error } = await supabase.auth.updateUser(
    Object.keys(meta).length ? { data: meta } : {},
  );
  if (error) throw error;
  if (fields.displayName !== undefined || fields.gender !== undefined) {
    await syncOwnProfile({ gender: fields.gender, displayName: fields.displayName });
  }
  const u = data.user;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? '',
    phone: u.phone ?? null,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
    gender: (u.user_metadata?.gender as Gender) ?? null,
  };
}

/**
 * Step 1 of the self-service email add/change: send a confirmation code to
 * the NEW address. Only takes effect once {@link verifyEmailChange} succeeds
 * (project has `mailer_secure_email_change_enabled=true` + a custom
 * `email_change` template rendering `{{ .Token }}`, mirroring the recovery
 * OTP-code flow) — required because email is now the password-recovery
 * channel for phone-registered accounts too, so an unverified typo must never
 * silently become it.
 */
export async function requestEmailChange(email: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase() });
  if (error) throw error;
}

/**
 * Step 2: verify the 6-digit code sent to the new address, completing the
 * email change. Mirrors {@link verifyPasswordResetCode}'s shape exactly.
 */
export async function verifyEmailChange(email: string, code: string): Promise<CurrentUser> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    const cur = raw ? (JSON.parse(raw) as CurrentUser) : null;
    if (!cur) throw new Error('لا يوجد حساب');
    const next: CurrentUser = { ...cur, email: email.trim().toLowerCase() };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(next));
    return next;
  }
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email_change',
  });
  if (error) throw error;
  const u = data.user!;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? '',
    phone: u.phone ?? null,
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
  // Bounded so a stalled server revoke (or a stuck GoTrue lock) can't hang the
  // sign-out spinner forever — on timeout we still guarantee a LOCAL sign-out,
  // which is what actually returns the app to the guest session.
  try {
    const { error } = await withAuthTimeout(supabase.auth.signOut());
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
 * Ban enforcement (admin «حظر»): GoTrue rejects a banned account on the /user
 * endpoint even while its access token is still unexpired, so a server-side
 * validation on app-foreground catches a ban within seconds instead of
 * waiting for the next token refresh. When the session turns out banned (or
 * the account was deleted), it is signed out exactly like a manual sign-out —
 * on native the device's guest session is restored so the app keeps working
 * as a guest. Network failures never sign anyone out (offline must stay
 * usable). Returns `{ banned: false }` when the session is fine.
 */
export async function checkBannedAndSignOut(): Promise<{
  banned: boolean;
  user: CurrentUser | null;
}> {
  if (USE_MOCK) return { banned: false, user: null };
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { banned: false, user: null };
  // Bounded: this runs on every app-foreground and holds the GoTrue auth lock
  // while it validates. If it stalls on a flaky network, an unbounded wait here
  // keeps the lock and can hang a concurrent sign-in tap («جارٍ الدخول…»). On
  // timeout we treat the session as fine (fail-open, same as a network error).
  let error: unknown = null;
  try {
    ({ error } = await withAuthTimeout(supabase.auth.getUser()));
  } catch {
    return { banned: false, user: null };
  }
  if (!error) return { banned: false, user: null };
  const status = (error as { status?: number }).status ?? 0;
  const code = (error as { code?: string }).code ?? '';
  if (code === 'user_banned' || code === 'user_not_found' || status === 403) {
    const user = await signOut();
    return { banned: true, user };
  }
  return { banned: false, user: null };
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

/**
 * Change password (signed-in user): requires the CURRENT password first — the
 * session alone isn't treated as sufficient proof here (unlike the admin's
 * "set new password with no old" action), so this re-authenticates with
 * whatever identifier the account has (email or phone, whichever exists) +
 * the typed current password before writing the new one. Re-signing in as
 * the SAME already-authenticated uid is a normal Supabase re-auth pattern —
 * it just refreshes the session, no destructive side effect.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  if (USE_MOCK) {
    return updatePassword(newPassword);
  }
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) throw new Error('لا يوجد حساب');
  const { error: verifyError } = u.email
    ? await supabase.auth.signInWithPassword({ email: u.email, password: currentPassword })
    : await supabase.auth.signInWithPassword({ phone: u.phone ?? '', password: currentPassword });
  if (verifyError) throw new Error('كلمة المرور الحالية غير صحيحة');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Self-service phone change — UNLIKE email, this is a single instant step: no
 * OTP is ever sent (project has `sms_autoconfirm` on), so the user can change
 * their own phone freely. Mirrors the admin's phone edit but from the client
 * with the user's own session instead of the service role.
 */
export async function changePhone(phone: string, countryCode: string): Promise<CurrentUser> {
  if (USE_MOCK) {
    const raw = await AsyncStorage.getItem(MOCK_SESSION_KEY);
    const cur = raw ? (JSON.parse(raw) as CurrentUser) : null;
    if (!cur) throw new Error('لا يوجد حساب');
    const next: CurrentUser = { ...cur, phone: normalizePhone(phone, countryCode) };
    await AsyncStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(next));
    return next;
  }
  const { data, error } = await supabase.auth.updateUser({ phone: normalizePhone(phone, countryCode) });
  if (error) throw error;
  const u = data.user;
  const role = (u.user_metadata?.role as AppRole) ?? fallbackRole();
  return {
    id: u.id,
    email: u.email ?? '',
    phone: u.phone ?? null,
    role,
    isGuest: u.is_anonymous ?? false,
    displayName: (u.user_metadata?.display_name as string) ?? null,
    gender: (u.user_metadata?.gender as Gender) ?? null,
  };
}
