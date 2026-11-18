/**
 * Contract test, STAGING: register() on a device that has NO session (the boot
 * guest sign-in failed on a weak connection — 2026-11-17 «تعذّر إتمام العملية»).
 * The real src/api/auth.ts register() runs on a client that starts empty; it
 * must get a guest itself and link phone + password onto it. The service key
 * only reads and deletes the account.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);

const mockHolder: { client: SupabaseClient | null } = { client: null };
jest.mock('@/lib/supabase', () => ({
  LAST_SESSION_KEY: 'sb-last-known-session',
  get supabase() {
    return mockHolder.client;
  },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));
const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => mockStore[k] ?? null,
  setItem: async (k: string, v: string) => {
    mockStore[k] = v;
  },
  removeItem: async (k: string) => {
    delete mockStore[k];
  },
}));

// eslint-disable-next-line import/first
import { register } from '@/api/auth';

const made: string[] = [];
afterAll(async () => {
  for (const id of made) await svc.auth.admin.deleteUser(id);
}, 60000);

test('a device with no session registers, and the account signs in with the phone', async () => {
  const c = createClient(url, anonKey, opts);
  mockHolder.client = c;
  expect((await c.auth.getSession()).data.session).toBeNull();

  const local = `09${String(Date.now()).slice(-8)}`;
  const password = `Sessionless-${Date.now()}`;
  const user = await register('اختبار بلا جلسة', local, '249', '', password, 'female');
  made.push(user.id);
  expect(user.isGuest).toBe(false);

  const { data } = await svc.auth.admin.getUserById(user.id);
  expect(data.user?.is_anonymous).toBe(false);
  expect(data.user?.phone).toBe(`249${local.slice(1)}`);
  // Signing in by phone is not checked here: the phone provider is off on
  // staging (on in production) — see phone-one-account.contract.test.ts.
}, 60000);
