/**
 * LOAD V24 — the database circuit breaker. 2026-10-04 a slow DB kept being
 * hammered by every app's reads and retries (a 32-minute self-feeding choke):
 * after 4 failures in 30 s a device pauses its /rest/v1/ requests, then lets
 * exactly one probe through.
 */
import {
  BREAKER_BASE_COOLDOWN_MS,
  BREAKER_FAILURES_TO_OPEN,
  BREAKER_MAX_COOLDOWN_MS,
  BREAKER_WINDOW_MS,
  createBreaker,
  isServerFailureStatus,
} from '../serverBreaker';

const T0 = 1_000_000;
const fixed = () => 0.5; // jitter factor exactly 1.0

test('closed by default; opens after 4 failures within 30 s', () => {
  const b = createBreaker(fixed);
  expect(b.allow(T0)).toBe(true);
  for (let i = 0; i < BREAKER_FAILURES_TO_OPEN - 1; i++) b.onFailure(T0 + i * 1000);
  expect(b.allow(T0 + 4000)).toBe(true);
  b.onFailure(T0 + 4000);
  expect(b.isOpen(T0 + 4001)).toBe(true);
  expect(b.allow(T0 + 4001)).toBe(false);
  expect(b.allow(T0 + 4000 + BREAKER_BASE_COOLDOWN_MS - 1)).toBe(false);
});

test('scattered failures (outside the 30 s window) never open it', () => {
  const b = createBreaker(fixed);
  for (let i = 0; i < 10; i++) b.onFailure(T0 + i * (BREAKER_WINDOW_MS + 1));
  expect(b.allow(T0 + 11 * BREAKER_WINDOW_MS)).toBe(true);
});

test('a success resets the count', () => {
  const b = createBreaker(fixed);
  for (let i = 0; i < BREAKER_FAILURES_TO_OPEN - 1; i++) b.onFailure(T0 + i);
  b.onSuccess();
  b.onFailure(T0 + 10);
  expect(b.allow(T0 + 11)).toBe(true);
});

test('after the cooldown exactly ONE probe goes out; its success closes the breaker', () => {
  const b = createBreaker(fixed);
  for (let i = 0; i < BREAKER_FAILURES_TO_OPEN; i++) b.onFailure(T0);
  const after = T0 + BREAKER_BASE_COOLDOWN_MS;
  expect(b.allow(after)).toBe(true); // the probe
  expect(b.allow(after + 1)).toBe(false); // everyone else waits for it
  b.onSuccess();
  expect(b.allow(after + 2)).toBe(true);
  expect(b.isOpen(after + 2)).toBe(false);
});

test('a failed probe re-opens with a doubled cooldown, capped at 2 min', () => {
  const b = createBreaker(fixed);
  for (let i = 0; i < BREAKER_FAILURES_TO_OPEN; i++) b.onFailure(T0);
  let now = T0 + BREAKER_BASE_COOLDOWN_MS;
  let cooldown = BREAKER_BASE_COOLDOWN_MS;
  for (let round = 0; round < 6; round++) {
    expect(b.allow(now)).toBe(true);
    b.onFailure(now);
    cooldown = Math.min(cooldown * 2, BREAKER_MAX_COOLDOWN_MS);
    expect(b.allow(now + cooldown - 1)).toBe(false);
    now += cooldown;
  }
  expect(cooldown).toBe(BREAKER_MAX_COOLDOWN_MS);
});

test('the cooldown is jittered (±25 %) so devices do not return in lockstep', () => {
  const early = createBreaker(() => 0);
  const late = createBreaker(() => 0.999);
  for (let i = 0; i < BREAKER_FAILURES_TO_OPEN; i++) {
    early.onFailure(T0);
    late.onFailure(T0);
  }
  expect(early.allow(T0 + BREAKER_BASE_COOLDOWN_MS * 0.75)).toBe(true);
  expect(late.allow(T0 + BREAKER_BASE_COOLDOWN_MS * 1.2)).toBe(false);
});

test('only 5xx counts as a server failure', () => {
  expect([500, 502, 503, 504, 520].every(isServerFailureStatus)).toBe(true);
  expect([200, 204, 400, 401, 403, 404, 409, 429].some(isServerFailureStatus)).toBe(false);
});

describe('wired into fetchWithTimeout (/rest/v1/ only)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test('after 4 server errors, database requests fail fast without touching the network; auth still goes out', async () => {
    let fetchWithTimeout!: typeof import('../supabase').fetchWithTimeout;
    jest.isolateModules(() => {
      ({ fetchWithTimeout } = require('../supabase'));
    });
    {
      const fetchMock = jest.fn(async () => new Response('{}', { status: 503 }));
      global.fetch = fetchMock as unknown as typeof fetch;
      for (let i = 0; i < BREAKER_FAILURES_TO_OPEN; i++) {
        await fetchWithTimeout('https://x.supabase.co/rest/v1/rpc/get_home_page', { method: 'POST' });
      }
      expect(fetchMock).toHaveBeenCalledTimes(BREAKER_FAILURES_TO_OPEN);
      await expect(
        fetchWithTimeout('https://x.supabase.co/rest/v1/notifications', {}),
      ).rejects.toThrow('server busy');
      expect(fetchMock).toHaveBeenCalledTimes(BREAKER_FAILURES_TO_OPEN);
      // GoTrue is never gated (session refresh has its own retry semantics).
      await fetchWithTimeout('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' });
      expect(fetchMock).toHaveBeenCalledTimes(BREAKER_FAILURES_TO_OPEN + 1);
    }
  });

  test("4xx answers and the caller's own cancellations never open it", async () => {
    let fetchWithTimeout!: typeof import('../supabase').fetchWithTimeout;
    jest.isolateModules(() => {
      ({ fetchWithTimeout } = require('../supabase'));
    });
    {
      const fetchMock = jest.fn(async () => new Response('{}', { status: 404 }));
      global.fetch = fetchMock as unknown as typeof fetch;
      for (let i = 0; i < 6; i++) await fetchWithTimeout('https://x.supabase.co/rest/v1/x', {});
      global.fetch = jest.fn(
        (_i: unknown, init?: RequestInit) =>
          new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')))),
      ) as unknown as typeof fetch;
      for (let i = 0; i < 6; i++) {
        const outer = new AbortController();
        const p = fetchWithTimeout('https://x.supabase.co/rest/v1/x', { signal: outer.signal });
        outer.abort();
        await expect(p).rejects.toThrow('Aborted');
      }
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(fetchWithTimeout('https://x.supabase.co/rest/v1/x', {})).resolves.toBeDefined();
    }
  });
});
