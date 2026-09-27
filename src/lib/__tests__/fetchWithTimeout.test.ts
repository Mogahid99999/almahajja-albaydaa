/**
 * fetchWithTimeout — the client-wide ceiling on auth/database requests
 * (2026-09-27 «جارٍ التسجيل…» hang). React Native's fetch never times out on
 * Android, so a stalled request used to hang registration forever.
 */
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from '../supabase';

const realFetch = global.fetch;

/** A fetch that never answers — it only settles when its signal aborts. */
const hangingFetch = jest.fn(
  (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    }),
);

beforeEach(() => {
  hangingFetch.mockClear();
  global.fetch = hangingFetch as unknown as typeof fetch;
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-27T13:00:00Z'));
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

test('a stalled auth request is aborted after the timeout instead of hanging forever', async () => {
  const pending = fetchWithTimeout('https://x.supabase.co/auth/v1/user', { method: 'PUT' });
  const assertion = expect(pending).rejects.toThrow('Aborted');
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  await assertion;
});

test('a stalled database request is aborted too', async () => {
  const pending = fetchWithTimeout('https://x.supabase.co/rest/v1/rpc/set_own_profile', {
    method: 'POST',
  });
  const assertion = expect(pending).rejects.toThrow('Aborted');
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  await assertion;
});

test('edge functions are left unbounded (backup-media can legitimately run long)', async () => {
  void fetchWithTimeout('https://x.supabase.co/functions/v1/backup-media', { method: 'POST' });
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3);
  const init = hangingFetch.mock.calls[0][1] as RequestInit | undefined;
  expect(init?.signal?.aborted ?? false).toBe(false);
});

test("a caller's own abort signal still cancels the request", async () => {
  const outer = new AbortController();
  const pending = fetchWithTimeout('https://x.supabase.co/rest/v1/lectures', {
    signal: outer.signal,
  });
  const assertion = expect(pending).rejects.toThrow('Aborted');
  outer.abort();
  await assertion;
});
