/**
 * Circuit breaker for database (PostgREST) requests — LOAD V24.
 *
 * 2026-10-04: once the DB slowed down, every app kept firing (and retrying)
 * its reads, which kept it slow — a self-feeding choke that lasted 32 minutes.
 * When the server is clearly failing (≥ 4 failures within 30 s: network
 * errors, our 30 s timeout, or a 5xx), this device stops sending /rest/v1/
 * requests for 20–40 s (jittered so devices don't come back in lockstep).
 * Then ONE probe goes through: success closes the breaker, failure re-opens it
 * with a doubled cooldown (max 2 min). A short-circuited request rejects like a
 * network error, so every caller's existing offline path applies (cached data
 * stays on screen, the outbox keeps queued writes).
 *
 * Auth (GoTrue) is deliberately NOT gated: session refresh has its own retry
 * semantics and must never be starved. Edge functions aren't gated either.
 */
export const BREAKER_FAILURES_TO_OPEN = 4;
export const BREAKER_WINDOW_MS = 30_000;
export const BREAKER_BASE_COOLDOWN_MS = 20_000;
export const BREAKER_MAX_COOLDOWN_MS = 120_000;

/** Thrown for a short-circuited request — a TypeError, like RN's own "Network request failed". */
export class ServerBusyError extends TypeError {
  constructor() {
    super('Network request failed (server busy — paused briefly)');
    this.name = 'ServerBusyError';
  }
}

export type Breaker = {
  /** May a request go out now? (While open: no. Right after the cooldown: exactly one probe.) */
  allow(nowMs: number): boolean;
  onSuccess(): void;
  onFailure(nowMs: number): void;
  isOpen(nowMs: number): boolean;
};

export function createBreaker(rand: () => number = Math.random): Breaker {
  let fails = 0;
  let firstFailAt = 0;
  let openUntil = 0;
  let cooldown = BREAKER_BASE_COOLDOWN_MS;
  let probing = false;
  const jitter = (ms: number) => Math.round(ms * (0.75 + rand() * 0.5));

  return {
    allow(now) {
      if (openUntil === 0) return true;
      if (now < openUntil || probing) return false;
      probing = true; // cooldown over: let exactly one request test the water
      return true;
    },
    onSuccess() {
      fails = 0;
      openUntil = 0;
      probing = false;
      cooldown = BREAKER_BASE_COOLDOWN_MS;
    },
    onFailure(now) {
      if (probing) {
        probing = false;
        cooldown = Math.min(cooldown * 2, BREAKER_MAX_COOLDOWN_MS);
        openUntil = now + jitter(cooldown);
        return;
      }
      if (openUntil !== 0) return; // a request that left before the breaker opened
      if (fails === 0 || now - firstFailAt > BREAKER_WINDOW_MS) {
        fails = 0;
        firstFailAt = now;
      }
      fails += 1;
      if (fails >= BREAKER_FAILURES_TO_OPEN) {
        fails = 0;
        openUntil = now + jitter(cooldown);
      }
    },
    isOpen(now) {
      return openUntil !== 0 && (now < openUntil || probing);
    },
  };
}

/** 5xx = the server (or its gateway) failed; 4xx is the request's own problem. */
export function isServerFailureStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/** The app-wide breaker for /rest/v1/. */
export const dbBreaker = createBreaker();
