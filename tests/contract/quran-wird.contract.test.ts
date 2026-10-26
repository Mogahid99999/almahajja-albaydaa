/**
 * Contract tests for migration 0162 («ورد القرآن اليومي») against STAGING:
 * a completed wird makes its day count in المداومة exactly like a meaningful
 * listening day — idempotent, own rows only, no seconds or lecture recorded,
 * an existing listening day left as it was, days outside the window ignored.
 * Anon-key clients only; the service key just creates/deletes the accounts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const admin = createClient(url, serviceKey, opts);

const stamp = Date.now();
const password = `Contract-${stamp}-x9`;
const created: string[] = [];

async function student(tag: string): Promise<SupabaseClient> {
  const email = `contract-0162-${tag}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'اختبار', gender: 'male' },
  });
  if (error) throw error;
  created.push(data.user.id);
  const c = newClient();
  const { error: se } = await c.auth.signInWithPassword({ email, password });
  if (se) throw se;
  return c;
}

// The server's day (the RPCs bound client days to current_date ± 1).
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function status(c: SupabaseClient) {
  const { data, error } = await c.rpc('get_streak_status', { p_today: day() });
  if (error) throw error;
  return (data as any[])[0];
}
async function myDays(c: SupabaseClient) {
  const { data, error } = await c.from('daily_listening').select('day, seconds_listened, lecture_ids, meaningful').order('day');
  if (error) throw error;
  return data as any[];
}

let a: SupabaseClient;
let b: SupabaseClient;
beforeAll(async () => {
  [a, b] = await Promise.all([student('a'), student('b')]);
});
afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map((c) => c.auth.signOut()));
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

test('a completed wird counts today in المداومة — once, with nothing else recorded', async () => {
  expect(await status(a)).toMatchObject({ today_counted: false, current_streak: 0 });
  expect((await a.rpc('record_quran_wird_day', { p_day: day() })).error).toBeNull();
  expect((await a.rpc('record_quran_wird_day', { p_day: day() })).error).toBeNull(); // replay
  expect(await status(a)).toMatchObject({ today_counted: true, current_streak: 1 });
  expect(await myDays(a)).toEqual([{ day: day(), seconds_listened: 0, lecture_ids: [], meaningful: true }]);
});

test('yesterday (replayed after being offline) + today = a 2-day streak', async () => {
  expect((await a.rpc('record_quran_wird_day', { p_day: day(-1) })).error).toBeNull();
  expect((await status(a)).current_streak).toBe(2);
});

test('a day already counted by listening keeps its listening seconds', async () => {
  expect((await b.rpc('record_meaningful_activity', { p_lecture_id: null, p_seconds: 150, p_completed: false })).error).toBeNull();
  const before = await myDays(b);
  expect((await b.rpc('record_quran_wird_day', { p_day: before[0].day })).error).toBeNull();
  expect(await myDays(b)).toEqual(before);
});

test('days outside the window are ignored; only the caller’s own rows are touched', async () => {
  const beforeB = await myDays(b);
  expect((await b.rpc('record_quran_wird_day', { p_day: day(-40) })).error).toBeNull();
  expect((await b.rpc('record_quran_wird_day', { p_day: day(5) })).error).toBeNull();
  expect(await myDays(b)).toEqual(beforeB);
  // a's rows are invisible to b.
  const { data } = await b.from('daily_listening').select('user_id');
  expect(new Set((data as any[]).map((r) => r.user_id)).size).toBeLessThanOrEqual(1);
});

test('the sessionless anon key cannot call it', async () => {
  const { error } = await newClient().rpc('record_quran_wird_day', { p_day: day() });
  expect(error).not.toBeNull();
});
