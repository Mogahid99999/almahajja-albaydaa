/**
 * register() — never hangs on «جارٍ التسجيل…» (2026-09-27 report).
 *
 * On a weak mobile signal a request could stall forever: the account was never
 * created (the phone never reached the server) and the button spun until the
 * app was killed. Separately, 5 accounts linked phone+password but lost the
 * final set_own_profile call — supabase.rpc() reports a network failure as a
 * returned `{ error }`, which the old code ignored. These pin both fixes.
 */

const mockUpdateUser: jest.Mock = jest.fn();
const mockInvoke: jest.Mock = jest.fn(async () => ({ data: { ok: true }, error: null }));
const mockRpc: jest.Mock = jest.fn(async () => ({ data: null, error: null }));

jest.mock('@/lib/supabase', () => ({
  LAST_SESSION_KEY: 'last-session',
  supabase: {
    auth: {
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      refreshSession: async () => ({ data: {}, error: null }),
      getSession: async () => ({ data: { session: null } }),
    },
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => {}),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => {}),
}));

import { register } from '../auth';

const user = {
  id: 'u1',
  email: '',
  phone: '249115526078',
  is_anonymous: false,
  user_metadata: { display_name: 'طيبة', gender: 'female' },
};

beforeEach(() => {
  mockUpdateUser.mockReset();
  mockInvoke.mockClear();
  mockRpc.mockReset();
  mockRpc.mockImplementation(async () => ({ data: null, error: null }));
});

afterEach(() => {
  jest.useRealTimers();
});

test('a stalled updateUser rejects with an Arabic error instead of spinning forever', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-27T13:00:00Z'));
  mockUpdateUser.mockImplementation(() => new Promise(() => {})); // never settles

  const pending = register('طيبة', '115526078', '249', '', 'password123', 'female');
  const assertion = expect(pending).rejects.toThrow('تعذّر إكمال العملية، تحقّق من اتصالك وحاول مرة أخرى');
  await jest.advanceTimersByTimeAsync(20_000);
  await assertion;
});

test('a failed set_own_profile is retried, so name/gender/oath still land', async () => {
  mockUpdateUser.mockResolvedValue({ data: { user }, error: null });
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })
    .mockResolvedValueOnce({ data: null, error: null });

  await expect(
    register('طيبة', '115526078', '249', '', 'password123', 'female'),
  ).resolves.toMatchObject({ isGuest: false, gender: 'female' });

  const profileCalls = mockRpc.mock.calls.filter((c) => c[0] === 'set_own_profile');
  expect(profileCalls).toHaveLength(2);
  expect(profileCalls[1][1]).toEqual({
    p_gender: 'female',
    p_display_name: 'طيبة',
    p_oath_accepted: true,
  });
});
