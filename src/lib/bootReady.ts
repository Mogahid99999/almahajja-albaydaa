import { Platform } from 'react-native';

/**
 * Hard boot timeout (item 9 — offline cold-start hang).
 *
 * A COLD launch while offline for a long time, OR while "connected but with no
 * internet data", used to hang forever on the boot loader. `SessionGate` held
 * the app until `!!user || ensure.isError`, but offline NEITHER settles: the
 * local session read (`getSession`) can stall on an internal auto-refresh when
 * the socket opens yet no bytes flow, and the anon sign-in network call just
 * stays pending instead of erroring — so the gate never falls through.
 *
 * This is the ceiling that saves the worst case (connected-but-no-internet,
 * where nothing ever errors): once it elapses we render the app from whatever
 * persisted session + persisted query cache already exist on disk. The app was
 * designed to run entirely from that cache after the first sync, so falling
 * through is safe — the `onReconnect` retry in SessionGate still converges the
 * anon sign-in + refetches once real internet returns.
 *
 * ~5s: long enough that a slow-but-working connection resolves a real session
 * first (so we don't flash into a session-less state on a merely sluggish
 * network), short enough that a truly dead connection doesn't feel frozen.
 */
export const BOOT_TIMEOUT_MS = 5_000;

/**
 * Pure boot-readiness decision, extracted so the "boot must resolve even when
 * neither a session nor an error ever settles" invariant is unit-testable
 * without React. Called from `SessionGate` on every render.
 *
 * Readiness rules:
 * - Web (admin dashboard): there is no silent anonymous session — readiness is
 *   simply "the auth check finished" (`!isLoading`). The timeout does not apply.
 * - Native: ready as soon as ANY of these holds —
 *     1. a session resolved (`hasUser`) — the happy path, also the offline-safe
 *        path when persisted tokens are still valid and `getSession` returns
 *        them without needing the network;
 *     2. the anon sign-in errored (`ensureErrored`) — fresh install, offline,
 *        server rejected — fall through as a guest-less session and let
 *        `onReconnect` mint the anon session when the network returns;
 *     3. the hard boot timeout elapsed (`timedOut`) — the connected-but-no-
 *        internet case where (1) and (2) can both stall indefinitely; render
 *        from the persisted cache anyway.
 *
 * Fonts are gated by the caller (`SessionGate` combines this with
 * `fontsLoaded`), not here, so this stays a pure session-readiness predicate.
 */
export function deriveBootReady(params: {
  isWeb: boolean;
  isLoading: boolean;
  hasUser: boolean;
  ensureErrored: boolean;
  timedOut: boolean;
}): boolean {
  const { isWeb, isLoading, hasUser, ensureErrored, timedOut } = params;
  if (isWeb) return !isLoading;
  return hasUser || ensureErrored || timedOut;
}

/** Convenience wrapper reading `Platform.OS` for callers that don't pass `isWeb`. */
export function deriveBootReadyForPlatform(params: {
  isLoading: boolean;
  hasUser: boolean;
  ensureErrored: boolean;
  timedOut: boolean;
}): boolean {
  return deriveBootReady({ isWeb: Platform.OS === 'web', ...params });
}
