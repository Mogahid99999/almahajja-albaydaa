/**
 * signIn — one quiet retry after a network failure (2026-11-15).
 *
 * After a long background or a locked screen, the first request often goes out
 * on a dead pooled connection and fails at the network layer; sign-in then
 * showed «تعذّر الاتصال بالخادم» until the app was restarted. A network
 * failure (AuthRetryableFetchError) is retried once; wrong credentials are not.
 */
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

const mockSignIn = jest.fn();

jest.mock('@/lib/supabase', () => ({
  LAST_SESSION_KEY: 'last-session',
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => {}),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => {}),
}));

import { signIn } from '../auth';

const okUser = { data: { user: { id: 'u1', email: 'a@b.c', phone: null, user_metadata: { role: 'student' } }, session: {} }, error: null };

beforeEach(() => {
  mockSignIn.mockReset();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-15T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());

test('a network failure is retried once and the sign-in succeeds', async () => {
  mockSignIn
    .mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthRetryableFetchError('Network request failed', 0) })
    .mockResolvedValueOnce(okUser);
  const p = signIn('a@b.c', 'pw');
  await jest.runAllTimersAsync();
  await expect(p).resolves.toMatchObject({ id: 'u1' });
  expect(mockSignIn).toHaveBeenCalledTimes(2);
});

test('a second network failure still reaches the screen (one retry only)', async () => {
  const err = new AuthRetryableFetchError('Network request failed', 0);
  mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: err });
  const p = signIn('a@b.c', 'pw');
  const settled = p.catch((e: unknown) => e);
  await jest.runAllTimersAsync();
  expect(await settled).toBe(err);
  expect(mockSignIn).toHaveBeenCalledTimes(2);
});

test('wrong credentials are not retried', async () => {
  const err = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');
  mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: err });
  const settled = signIn('a@b.c', 'pw').catch((e: unknown) => e);
  await jest.runAllTimersAsync();
  expect(await settled).toBe(err);
  expect(mockSignIn).toHaveBeenCalledTimes(1);
});
