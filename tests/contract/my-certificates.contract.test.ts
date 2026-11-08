/**
 * Contract tests for migration 0169 — get_my_certificates («شهاداتي»), STAGING.
 *
 * Fixture (all «تجربة», deleted in afterAll):
 *   NONE     main, no certificate       1 lecture
 *   ONLY     main, cert «هذا القسم فقط»  2 lectures · sub ONLY_SUB 2 lectures
 *   PATH     main, cert subtree         2 lectures · sub PATH_SUB 2 lectures · quiz Q
 *   BROS     main, brothers only, cert  1 lecture
 *   EMPTY    main, cert «هذا القسم فقط»  no lecture of its own
 *   OFF      main, cert disabled        1 lecture
 *   OUTER    main, no certificate       └ MID (none) └ LEAF cert, 1 lecture
 *
 * Pins: ancestor_ids (the mark on OUTER and MID, which are not listed themselves);
 * which sections are listed (enabled, visible to the caller's gender,
 * something to complete); every row's eligibility IS certificate_eligibility;
 * the student journey (progressing → lectures done with a quiz left → awaiting
 * grading → earned) moves the row from «قيد الإنجاز» to earned, earned first;
 * anon is refused. No fan-out (see certificates.contract.test.ts).
 */
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ts = Date.now();
const sectionIds: string[] = [];
const userIds: string[] = [];
const clients: SupabaseClient[] = [];
let quizId = '';
let none = '';
let only = '';
let path = '';
let bros = '';
let empty = '';
let off = '';
let outer = '';
let mid = '';
let leaf = '';
const lec: Record<string, string[]> = {};
let admin: SupabaseClient;
let brother: SupabaseClient;
let sister: SupabaseClient;
let sisterId = '';

async function signIn(email: string, password: string) {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  clients.push(c);
  return c;
}

async function throwaway(label: string, gender: 'male' | 'female'): Promise<[SupabaseClient, string]> {
  const email = `tajriba-mycert-${label}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `تجربة شهاداتي ${label}` },
  });
  if (error || !data.user) throw error ?? new Error('user not created');
  userIds.push(data.user.id);
  const upd = await service.from('profiles').update({ gender }).eq('id', data.user.id);
  if (upd.error) throw upd.error;
  return [await signIn(email, password), data.user.id];
}

async function section(title: string, parent: string | null = null, visibility = 'all') {
  const { data, error } = await service
    .from('sections')
    .insert({ title: `تجربة ${title} ${ts}`, parent_id: parent, visibility })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('section not created');
  sectionIds.push(data.id);
  return data.id as string;
}

async function lectures(sectionId: string, n: number) {
  const { data, error } = await service
    .from('lectures')
    .insert(
      Array.from({ length: n }, (_, i) => ({
        title: `تجربة محاضرة ${ts}-${sectionId.slice(0, 4)}-${i}`,
        audio_path: `lectures/تجربة/mycert-${ts}-${i}.mp3`,
        duration_sec: 600,
        order: i + 1,
        status: 'published',
        section_id: sectionId,
        notify_on_publish: false,
      })),
    )
    .select('id, order')
    .order('order');
  if (error || !data) throw error ?? new Error('lectures not created');
  return data.map((r) => r.id as string);
}

async function setCert(sectionId: string, scope: 'section' | 'subtree', quizIds: string[] = [], enabled = true) {
  const { error } = await admin.rpc('set_section_certificate_settings', {
    p_section: sectionId,
    p_enabled: enabled,
    p_content_scope: scope,
    p_lecture_rule: 'all',
    p_lecture_pct: null,
    p_quiz_rule: quizIds.length ? 'selected' : 'none',
    p_quiz_ids: quizIds,
  });
  if (error) throw error;
}

async function complete(userId: string, ids: string[]) {
  const { error } = await service.from('user_lecture_progress').upsert(
    ids.map((lecture_id) => ({ user_id: userId, lecture_id, position_sec: 600, completed: true })),
    { onConflict: 'user_id,lecture_id' },
  );
  if (error) throw error;
}

async function mine(c: SupabaseClient): Promise<any[]> {
  const { data, error } = await c.rpc('get_my_certificates');
  if (error) throw error;
  // staging may hold other certificate sections; only look at this suite's
  return (data as any[]).filter((r) => sectionIds.includes(r.section_id));
}
const rowOf = (rows: any[], id: string) => rows.find((r) => r.section_id === id);

beforeAll(async () => {
  if (!serviceKey) throw new Error('contract tests need SUPABASE_SECRET_KEY in .env.staging.local');
  admin = await signIn('admin@gmail.com', '12345678');
  [brother] = await throwaway('brother', 'male');
  [sister, sisterId] = await throwaway('sister', 'female');

  none = await section('بلا شهادة');
  only = await section('هذا القسم فقط');
  const onlySub = await section('فرع القسم', only);
  path = await section('المسار');
  const pathSub = await section('فرع المسار', path);
  bros = await section('للإخوة', null, 'male');
  empty = await section('بلا محاضرات');
  off = await section('شهادة معطلة');
  outer = await section('رئيسي بلا شهادة');
  mid = await section('وسيط بلا شهادة', outer);
  leaf = await section('فرع بشهادة', mid);

  lec.none = await lectures(none, 1);
  lec.only = await lectures(only, 2);
  lec.onlySub = await lectures(onlySub, 2);
  lec.path = await lectures(path, 2);
  lec.pathSub = await lectures(pathSub, 2);
  lec.bros = await lectures(bros, 1);
  lec.off = await lectures(off, 1);
  lec.leaf = await lectures(leaf, 1);

  quizId = randomUUID();
  const fe = await service
    .from('fanout_queue')
    .insert({ kind: 'quiz', ref_id: quizId, params: { sent: true }, done_at: new Date().toISOString() });
  if (fe.error) throw fe.error;
  const q = await service
    .from('quizzes')
    .insert({ id: quizId, section_id: pathSub, title: 'تجربة اختبار المسار', pass_score: 1, status: 'published' });
  if (q.error) throw q.error;

  await setCert(only, 'section');
  await setCert(path, 'subtree', [quizId]);
  await setCert(bros, 'section');
  await setCert(empty, 'section');
  await setCert(off, 'section', [], false);
  await setCert(leaf, 'section');
}, 120_000);

afterAll(async () => {
  await service.from('fanout_queue').delete().eq('ref_id', quizId);
  for (const id of [...sectionIds].reverse()) await service.from('sections').delete().eq('id', id);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await Promise.all(clients.map((c) => c.auth.signOut()));
});

test('listed: enabled, visible and with something to complete — nothing else', async () => {
  const forSister = (await mine(sister)).map((r) => r.section_id).sort();
  expect(forSister).toEqual([only, path, leaf].sort()); // no NONE, OFF, EMPTY, brothers-only
  const forBrother = (await mine(brother)).map((r) => r.section_id).sort();
  expect(forBrother).toEqual([only, path, bros, leaf].sort());
});

test('a certificate names every section above it; a top-level one has none', async () => {
  const rows = await mine(sister);
  expect(rowOf(rows, leaf).ancestor_ids).toEqual([mid, outer]);
  expect(rowOf(rows, only).ancestor_ids).toEqual([]);
  expect(rowOf(rows, outer)).toBeUndefined(); // marked, but it grants nothing itself
});

test('a row carries certificate_eligibility itself, following each content scope', async () => {
  const rows = await mine(sister);
  for (const id of [only, path]) {
    const { data } = await sister.rpc('certificate_eligibility', { p_section: id, p_user: null });
    expect(rowOf(rows, id).eligibility).toEqual(data);
  }
  expect(rowOf(rows, only).eligibility.lectures).toMatchObject({ scope: 'section', total: 2, required: 2 });
  expect(rowOf(rows, path).eligibility.lectures).toMatchObject({ scope: 'subtree', total: 4, required: 4 });
});

test('«هذا القسم فقط»: completing it earns it, and earned rows come first', async () => {
  await complete(sisterId, lec.path.slice(0, 1)); // some progress elsewhere
  await complete(sisterId, lec.only.slice(0, 1));
  let r = rowOf(await mine(sister), only);
  expect(r.eligibility).toMatchObject({ eligible: false, lectures: { completed: 1, completed_pct: 50 } });

  await complete(sisterId, lec.only.slice(1));
  const rows = await mine(sister);
  r = rowOf(rows, only);
  expect(r.eligibility).toMatchObject({ eligible: true, lectures: { completed: 2, met: true } });
  expect(rows[0].section_id).toBe(only);
});

test('subtree with a quiz: lectures done → quiz left → awaiting grading → earned', async () => {
  await complete(sisterId, [...lec.path, ...lec.pathSub]);
  let e = rowOf(await mine(sister), path).eligibility;
  expect(e.lectures).toMatchObject({ total: 4, completed: 4, met: true });
  expect(e.quizzes).toMatchObject({ required_count: 1, passed_count: 0, met: false });
  expect(e.quizzes.items[0]).toMatchObject({ passed: false, pending_grading: false });
  expect(e.eligible).toBe(false);

  const { data: att, error } = await service
    .from('quiz_attempts')
    .insert({
      quiz_id: quizId,
      user_id: sisterId,
      attempt_no: 1,
      submitted_at: new Date().toISOString(),
      grading_status: 'pending',
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  e = rowOf(await mine(sister), path).eligibility;
  expect(e.quizzes.items[0]).toMatchObject({ passed: false, pending_grading: true });
  expect(e.eligible).toBe(false);

  const g = await service
    .from('quiz_attempts')
    .update({ grading_status: 'graded', passed: true, score: 1 })
    .eq('id', att!.id);
  expect(g.error).toBeNull();
  e = rowOf(await mine(sister), path).eligibility;
  expect(e.quizzes).toMatchObject({ passed_count: 1, met: true });
  expect(e.eligible).toBe(true);
});

test('one student never sees another student’s progress', async () => {
  const rows = await mine(brother);
  expect(rowOf(rows, only).eligibility).toMatchObject({ eligible: false, lectures: { completed: 0 } });
});

test('anon is refused', async () => {
  const { error } = await newClient().rpc('get_my_certificates');
  expect(error).not.toBeNull();
});
