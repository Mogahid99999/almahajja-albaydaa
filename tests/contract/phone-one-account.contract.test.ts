/**
 * Contract tests for 0177 and the international phone rule, STAGING. Numbers are
 * fictional and unique to the run; accounts are removed in afterAll. The phone
 * provider must be on, as it is on production, for password sign-in by phone.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { phoneLoginCandidates, toInternationalPhone } from '../../src/lib/phone';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service: SupabaseClient = createClient(url, serviceKey, opts);
const password = `Tajriba-${Date.now()}-pw`;
const made: string[] = [];
// Six run-specific digits, so repeated runs never meet each other's numbers.
const tail = String(Date.now()).slice(-6);

async function guest() {
  const c = createClient(url, anonKey, opts);
  const a = await c.auth.signInAnonymously();
  if (a.error) throw a.error;
  made.push(a.data.user!.id);
  return c;
}

/** The app's registration: a guest gains phone + password. */
const register = async (c: SupabaseClient, phone: string) => c.auth.updateUser({ phone, password });

async function legacyAccount(phone: string) {
  const { data, error } = await service.auth.admin.createUser({ phone, password, phone_confirm: true });
  if (error) throw error;
  made.push(data.user.id);
  return data.user.id;
}

async function signIn(raw: string, dial?: string) {
  const c = createClient(url, anonKey, opts);
  for (const phone of phoneLoginCandidates(raw, dial)) {
    const r = await c.auth.signInWithPassword({ phone, password });
    if (!r.error) return r.data.user;
    if (r.error.code !== 'invalid_credentials') throw r.error;
  }
  return null;
}

const conflict = async (c: SupabaseClient, phone: string) =>
  (await c.rpc('phone_registration_conflict', { p_phone: phone })).data;

afterAll(async () => {
  for (const id of made) await service.auth.admin.deleteUser(id);
}, 120000);

test.each([
  ['السودان', '249', `09${tail}000`.slice(0, 10)],
  ['السعودية', '966', `05${tail}11`],
  ['مصر', '20', `010${tail}22`],
  ['نيجيريا', '234', `0803${tail}3`],
  ['باكستان', '92', `0300${tail}4`],
  ['مالي', '223', `70${tail}`],
])('%s: stored internationally, then signs in', async (_n, dial, local) => {
  const c = await guest();
  const international = toInternationalPhone(local, dial)!;
  expect(international).toMatch(/^\+/);
  const r = await register(c, international);
  expect(r.error).toBeNull();
  expect(r.data.user!.phone).toBe(international.slice(1));
  const u = await signIn(local, dial);
  expect(u?.id).toBe(r.data.user!.id);
}, 60000);

test('an old account with no calling code still signs in, with any country selected', async () => {
  const stored = `31${tail}77`;
  const id = await legacyAccount(stored);
  expect((await signIn(`0${stored}`, '249'))?.id).toBe(id);
  expect((await signIn(`0${stored}`, '92'))?.id).toBe(id);
}, 60000);

test('an old Egyptian account signs in; its row is not rewritten', async () => {
  const stored = `10${tail}88`;
  const id = await legacyAccount(stored);
  expect((await signIn(`0${stored}`))?.id).toBe(id);
  const { data } = await service.auth.admin.getUserById(id);
  expect(data.user?.phone).toBe(stored);
}, 60000);

test('a new number cannot duplicate an old account holding the same digits', async () => {
  const stored = `80${tail}99`;
  await legacyAccount(stored);
  const c = await guest();
  expect(await conflict(c, `+234${stored}`)).toBe(true);
  expect((await register(c, `+234${stored}`)).error).not.toBeNull();
}, 60000);

test('an old build sending national digits cannot duplicate an international account', async () => {
  const national = `81${tail}55`;
  const a = await guest();
  expect((await register(a, `+234${national}`)).error).toBeNull();
  const b = await guest();
  expect(await conflict(b, national)).toBe(true);
  expect((await register(b, national)).error).not.toBeNull();
}, 60000);

test('the same international number twice is refused', async () => {
  const phone = `+249912${tail}`;
  const a = await guest();
  expect((await register(a, phone)).error).toBeNull();
  const b = await guest();
  expect(await conflict(b, phone)).toBe(true);
  expect((await register(b, phone)).error).not.toBeNull();
}, 60000);

test('an Egyptian-shaped old row only collides with +20', async () => {
  const stored = `11${tail}66`;
  await legacyAccount(stored);
  const c = await guest();
  expect(await conflict(c, `+20${stored}`)).toBe(true);
  expect(await conflict(c, `+966${stored}`)).toBe(false);
}, 60000);

test('saving your own number again is not a conflict; a free number is not one', async () => {
  const phone = `+249913${tail}`;
  const a = await guest();
  expect((await register(a, phone)).error).toBeNull();
  expect(await conflict(a, phone)).toBe(false);
  expect(await conflict(a, `+249914${tail}`)).toBe(false);
}, 60000);
