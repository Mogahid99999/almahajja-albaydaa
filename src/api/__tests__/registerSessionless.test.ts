/**
 * register() on a device with NO session (2026-11-17, Sudan).
 *
 * register() links phone + password onto the CURRENT guest account. When the
 * boot guest sign-in failed on a weak connection, the app opened with no
 * session and only retried it on reconnect or on return to the foreground —
 * never while the student sat on the form. supabase-js then refused the
 * update locally («Auth session missing!», no request at all), which matched
 * no mapping and showed «تعذّر إتمام العملية، حاول مرة أخرى.» on every press:
 * 27 failed attempts from Khartoum in 20 minutes, phone check 401 as anon.
 *
 * register() now gets the guest session itself first: the device's own guest,
 * else a fresh anonymous one — never the last-known session, which may be a
 * REGISTERED account whose phone and password this would overwrite.
 */
const mockCalls: string[] = [];
let mockSession: { user: { is_anonymous: boolean } } | null = null;
let mockSessionError: Error | null = null;
let mockStored: Record<string, string> = {};

const mockUpdateUser: jest.Mock = jest.fn(async () => {
  mockCalls.push(mockSession ? 'updateUser' : 'updateUser(no session)');
  if (!mockSession) return { data: { user: null }, error: new Error('Auth session missing!') };
  return {
    data: { user: { id: 'g1', phone: '249912345678', is_anonymous: false, user_metadata: {} } },
    error: null,
  };
});
const mockSignInAnonymously: jest.Mock = jest.fn(async () => {
  mockCalls.push('signInAnonymously');
  mockSession = { user: { is_anonymous: true } };
  return {
    data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'g-new' } },
    error: null,
  };
});
const mockSetSession: jest.Mock = jest.fn(async (tokens: { refresh_token: string }) => {
  mockCalls.push(`setSession(${tokens.refresh_token})`);
  const anon = tokens.refresh_token === 'guest-r';
  mockSession = { user: { is_anonymous: anon } };
  return {
    data: { session: { access_token: 'a2', refresh_token: 'r2' }, user: { id: 'x', is_anonymous: anon } },
    error: null,
  };
});

jest.mock('@/lib/supabase', () => ({
  LAST_SESSION_KEY: 'last-session',
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockSession }, error: mockSessionError }),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      signInAnonymously: () => mockSignInAnonymously(),
      setSession: (t: { refresh_token: string }) => mockSetSession(t),
      refreshSession: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
    rpc: async () => ({ data: false, error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async (k: string, v: string) => {
    mockStored[k] = v;
  }),
  getItem: jest.fn(async (k: string) => mockStored[k] ?? null),
  removeItem: jest.fn(async (k: string) => {
    delete mockStored[k];
  }),
}));

import { arabicAuthError } from '@/lib/authErrors';

import { register } from '../auth';

const registerStudent = () =>
  register('شيماء', '0912345678', '249', '', 'password123', 'female');

beforeEach(() => {
  mockCalls.length = 0;
  mockSession = null;
  mockSessionError = null;
  mockStored = {};
  mockSetSession.mockClear();
  mockSignInAnonymously.mockClear();
});

test('no session and no stored guest: a guest is created, then the account is linked', async () => {
  await expect(registerStudent()).resolves.toMatchObject({ isGuest: false });
  expect(mockCalls).toEqual(['signInAnonymously', 'updateUser']);
});

test("no session but the device's own guest is stored: that guest is restored, not a new one", async () => {
  mockStored['device-guest-session'] = JSON.stringify({ access_token: 'ga', refresh_token: 'guest-r' });
  await registerStudent();
  expect(mockCalls).toEqual(['setSession(guest-r)', 'updateUser']);
  expect(mockSignInAnonymously).not.toHaveBeenCalled();
});

test('the last-known session (maybe a registered account) is never used to register onto', async () => {
  mockStored['last-session'] = JSON.stringify({ access_token: 'ra', refresh_token: 'registered-r' });
  await registerStudent();
  expect(mockSetSession).not.toHaveBeenCalledWith(expect.objectContaining({ refresh_token: 'registered-r' }));
  expect(mockCalls).toEqual(['signInAnonymously', 'updateUser']);
});

test('an existing guest session is used as is', async () => {
  mockSession = { user: { is_anonymous: true } };
  await registerStudent();
  expect(mockCalls).toEqual(['updateUser']);
});

test('a stored session that cannot refresh right now is a network error, not a new guest', async () => {
  mockSessionError = new Error('Network request failed');
  await expect(registerStudent()).rejects.toThrow('Network request failed');
  expect(mockSignInAnonymously).not.toHaveBeenCalled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

test('«Auth session missing!» never shows the generic «تعذّر إتمام العملية»', () => {
  expect(arabicAuthError(new Error('Auth session missing!'))).not.toBe('تعذّر إتمام العملية، حاول مرة أخرى.');
});
