/**
 * Contract tests for migration 0168 — «شهادة إتمام القسم»: settings + the
 * central eligibility check, against the STAGING project.
 *
 * Fixture tree (all «تجربة», deleted in afterAll):
 *   root  (visibility all)   8 published lectures + 1 draft · quiz Q1 (published) · Q3 (draft)
 *   ├─ A  (visibility all)   2 published lectures           · quiz Q2 (published)
 *   └─ M  (brothers only)    2 published lectures
 *   other root section        quiz QX (not in the subtree)
 * ⇒ a brother counts 12 lectures, a sister 10 (M is hidden from her).
 *
 * Pins:
 *   - settings: content managers only; validation (pct 1–100, ≥ 1 quiz, quiz
 *     must be in the subtree); disabling keeps the conditions; the picker lists
 *     the subtree's quizzes (draft included, flagged).
 *   - lectures: whole subtree, published only, gender-visible only; completion
 *     from any source (recording or live 0167) counts; 'percent' needs
 *     ⌈total × pct ⁄ 100⌉ (70 % of 10 = 7 exactly); 'all' needs every one; an
 *     empty section never qualifies.
 *   - quizzes: passed = an attempt with passed = true; a failed attempt and a
 *     written-answer attempt still «بانتظار التصحيح» don't count until graded;
 *     a draft required quiz is not required until published.
 *   - eligible = enabled ∧ lectures ∧ quizzes; another user's eligibility is
 *     staff-only; anon gets nothing.
 *
 * No fan-out: lectures are inserted with notify_on_publish off; every quiz gets
 * a pre-marked «sent» fanout_queue row before it is inserted (as in
 * quiz-written.contract.test.ts).
 */
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const STAFF_PASSWORD = '12345678';
const DENIED = 'غير مصرح';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ts = Date.now();
const sectionIds: string[] = [];
const quizIds: string[] = [];
const userIds: string[] = [];
const clients: SupabaseClient[] = [];

let root = '';
let secA = '';
let secM = '';
let other = '';
const rootLectures: string[] = [];
const aLectures: string[] = [];
const mLectures: string[] = [];
let draftLecture = '';
let q1 = '';
let q2 = '';
let q3 = '';
let qx = '';

let admin: SupabaseClient;
let sheikh: SupabaseClient;
let anon: SupabaseClient;
let brother: SupabaseClient;
let sister: SupabaseClient;
let brotherId = '';
let sisterId = '';

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  clients.push(c);
  return c;
}

async function throwaway(label: string, gender: 'male' | 'female'): Promise<[SupabaseClient, string]> {
  const email = `tajriba-cert-${label}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `تجربة شهادة ${label}` },
  });
  if (error || !data.user) throw error ?? new Error('throwaway user not created');
  userIds.push(data.user.id);
  const upd = await service.from('profiles').update({ gender }).eq('id', data.user.id);
  if (upd.error) throw upd.error;
  return [await signIn(email, password), data.user.id];
}

async function section(title: string, parent: string | null, visibility: 'all' | 'male' | 'female') {
  const { data, error } = await service
    .from('sections')
    .insert({ title, parent_id: parent, visibility })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('section not created');
  sectionIds.push(data.id);
  return data.id as string;
}

async function lectures(sectionId: string, n: number, status: 'published' | 'draft' = 'published') {
  const rows = Array.from({ length: n }, (_, i) => ({
    title: `تجربة محاضرة شهادة ${ts}-${sectionId.slice(0, 4)}-${status}-${i + 1}`,
    audio_path: `lectures/تجربة/cert-${ts}-${i}.mp3`,
    duration_sec: 600,
    order: i + 1,
    status,
    section_id: sectionId,
    notify_on_publish: false,
  }));
  const { data, error } = await service.from('lectures').insert(rows).select('id, order').order('order');
  if (error || !data) throw error ?? new Error('lectures not created');
  return data.map((r) => r.id as string);
}

async function quiz(sectionId: string, title: string, status: 'published' | 'draft') {
  const id = randomUUID();
  const fe = await service
    .from('fanout_queue')
    .insert({ kind: 'quiz', ref_id: id, params: { sent: true }, done_at: new Date().toISOString() });
  if (fe.error) throw fe.error;
  const { error } = await service
    .from('quizzes')
    .insert({ id, section_id: sectionId, title, pass_score: 1, status });
  if (error) throw error;
  quizIds.push(id);
  return id;
}

async function complete(userId: string, ids: string[], source: 'live' | null = null) {
  const { error } = await service.from('user_lecture_progress').upsert(
    ids.map((lecture_id) => ({
      user_id: userId,
      lecture_id,
      position_sec: 600,
      completed: true,
      completed_at: new Date().toISOString(),
      completion_source: source,
    })),
    { onConflict: 'user_id,lecture_id' },
  );
  if (error) throw error;
}

async function attempt(
  userId: string,
  quizId: string,
  no: number,
  fields: { passed: boolean | null; grading_status?: 'pending' | 'graded' | null },
) {
  const { data, error } = await service
    .from('quiz_attempts')
    .insert({
      quiz_id: quizId,
      user_id: userId,
      attempt_no: no,
      submitted_at: new Date().toISOString(),
      score: fields.passed === null ? null : fields.passed ? 1 : 0,
      passed: fields.passed,
      grading_status: fields.grading_status ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('attempt not created');
  return data.id as string;
}

async function saveSettings(
  c: SupabaseClient,
  s: { enabled: boolean; lectureRule: 'all' | 'percent'; pct: number | null; quizRule: 'none' | 'selected'; quizIds?: string[] },
  sectionId = root,
) {
  return c.rpc('set_section_certificate_settings', {
    p_section: sectionId,
    p_enabled: s.enabled,
    p_lecture_rule: s.lectureRule,
    p_lecture_pct: s.pct,
    p_quiz_rule: s.quizRule,
    p_quiz_ids: s.quizIds ?? [],
  });
}

async function eligibility(c: SupabaseClient, userId?: string, sectionId = root): Promise<Record<string, any>> {
  const { data, error } = await c.rpc('certificate_eligibility', { p_section: sectionId, p_user: userId ?? null });
  if (error) throw error;
  return data as Record<string, any>;
}

beforeAll(async () => {
  if (!serviceKey) throw new Error('contract tests need SUPABASE_SECRET_KEY in .env.staging.local');
  anon = newClient();
  admin = await signIn('admin@gmail.com', STAFF_PASSWORD);
  sheikh = await signIn('sheikh@gmail.com', STAFF_PASSWORD);
  [brother, brotherId] = await throwaway('brother', 'male');
  [sister, sisterId] = await throwaway('sister', 'female');

  root = await section(`تجربة قسم الشهادة ${ts}`, null, 'all');
  secA = await section(`تجربة فرع عام ${ts}`, root, 'all');
  secM = await section(`تجربة فرع الإخوة ${ts}`, root, 'male');
  other = await section(`تجربة قسم آخر ${ts}`, null, 'all');

  rootLectures.push(...(await lectures(root, 8)));
  [draftLecture] = await lectures(root, 1, 'draft');
  aLectures.push(...(await lectures(secA, 2)));
  mLectures.push(...(await lectures(secM, 2)));

  q1 = await quiz(root, 'تجربة اختبار الجذر', 'published');
  q2 = await quiz(secA, 'تجربة اختبار الفرع', 'published');
  q3 = await quiz(root, 'تجربة اختبار مسودة', 'draft');
  qx = await quiz(other, 'تجربة اختبار خارجي', 'published');
}, 120_000);

afterAll(async () => {
  for (const id of quizIds) await service.from('fanout_queue').delete().eq('ref_id', id);
  // children first (sections cascade lectures, quizzes, attempts, progress, settings)
  for (const id of [...sectionIds].reverse()) await service.from('sections').delete().eq('id', id);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await Promise.all(clients.map((c) => c.auth.signOut()));
});

describe('settings — who and what', () => {
  test('a never-configured section reads the defaults and lists the subtree quizzes only', async () => {
    const { data, error } = await admin.rpc('get_section_certificate_settings', { p_section: root });
    expect(error).toBeNull();
    const s = data as Record<string, any>;
    expect(s).toMatchObject({ enabled: false, lecture_rule: 'all', lecture_pct: null, quiz_rule: 'none' });
    const ids = (s.quizzes as any[]).map((q) => q.id).sort();
    expect(ids).toEqual([q1, q2, q3].sort());
    expect((s.quizzes as any[]).find((q) => q.id === q3).status).toBe('draft');
    expect((s.quizzes as any[]).find((q) => q.id === q2).section_title).toBe(`تجربة فرع عام ${ts}`);
  });

  test('students, sheikhs and anon cannot read or write the settings', async () => {
    for (const c of [brother, sheikh, anon]) {
      const r = await c.rpc('get_section_certificate_settings', { p_section: root });
      expect(r.error).not.toBeNull();
      const w = await saveSettings(c, { enabled: true, lectureRule: 'all', pct: null, quizRule: 'none' });
      expect(w.error).not.toBeNull();
    }
    const w = await saveSettings(brother, { enabled: true, lectureRule: 'all', pct: null, quizRule: 'none' });
    expect(w.error!.message).toContain(DENIED);
    for (const c of [brother, anon]) {
      const t = await c.from('section_certificate_settings').select('*').eq('section_id', root);
      expect(t.data ?? []).toHaveLength(0);
    }
  });

  test('validation: percentage 1–100, at least one quiz, quizzes of this subtree only', async () => {
    const bad = [
      [{ enabled: true, lectureRule: 'percent', pct: 0, quizRule: 'none' }, 'بين ١ و١٠٠'],
      [{ enabled: true, lectureRule: 'percent', pct: 101, quizRule: 'none' }, 'بين ١ و١٠٠'],
      [{ enabled: true, lectureRule: 'percent', pct: null, quizRule: 'none' }, 'بين ١ و١٠٠'],
      [{ enabled: true, lectureRule: 'all', pct: null, quizRule: 'selected', quizIds: [] }, 'اختبارًا واحدًا'],
      [{ enabled: true, lectureRule: 'all', pct: null, quizRule: 'selected', quizIds: [q1, qx] }, 'ليس من اختبارات هذا القسم'],
    ] as const;
    for (const [s, msg] of bad) {
      const { error } = await saveSettings(admin, s as any);
      expect({ s, msg: error?.message.includes(msg) }).toEqual({ s, msg: true });
    }
    expect((await service.from('section_certificate_settings').select('*').eq('section_id', root)).data).toHaveLength(0);
  });

  test('saving stores the rule; "all" stores no percentage; disabling keeps the conditions', async () => {
    expect((await saveSettings(admin, { enabled: true, lectureRule: 'all', pct: 50, quizRule: 'none' })).error).toBeNull();
    let s = (await admin.rpc('get_section_certificate_settings', { p_section: root })).data as any;
    expect(s).toMatchObject({ enabled: true, lecture_rule: 'all', lecture_pct: null, quiz_rule: 'none' });

    expect(
      (await saveSettings(admin, { enabled: true, lectureRule: 'percent', pct: 70, quizRule: 'selected', quizIds: [q1, q1, q2] }))
        .error,
    ).toBeNull();
    expect(
      (await saveSettings(admin, { enabled: false, lectureRule: 'percent', pct: 70, quizRule: 'selected', quizIds: [q1, q2] }))
        .error,
    ).toBeNull();
    s = (await admin.rpc('get_section_certificate_settings', { p_section: root })).data as any;
    expect(s).toMatchObject({ enabled: false, lecture_rule: 'percent', lecture_pct: 70, quiz_rule: 'selected' });
    expect((s.quizzes as any[]).filter((q) => q.selected).map((q) => q.id).sort()).toEqual([q1, q2].sort());
  });
});

describe('eligibility — lectures', () => {
  test('disabled: the breakdown is there but nobody is eligible', async () => {
    const e = await eligibility(sister);
    expect(e.enabled).toBe(false);
    expect(e.eligible).toBe(false);
    expect(e.lectures).toMatchObject({ rule: 'percent', pct: 70, total: 10, completed: 0, required: 7, met: false });
  });

  test('subtree, published, gender-visible: a brother counts 12, a sister 10 (draft never)', async () => {
    await saveSettings(admin, { enabled: true, lectureRule: 'percent', pct: 70, quizRule: 'none' });
    expect((await eligibility(brother)).lectures).toMatchObject({ total: 12, required: 9 });
    expect((await eligibility(sister)).lectures).toMatchObject({ total: 10, required: 7 });
    await complete(sisterId, [draftLecture, ...mLectures]); // neither counts for her
    expect((await eligibility(sister)).lectures.completed).toBe(0);
  });

  test('percent: 6 of 10 is not enough, exactly 70 % (7 of 10) is — any completion source counts', async () => {
    await complete(sisterId, rootLectures.slice(0, 5));
    await complete(sisterId, [aLectures[0]], 'live'); // completed by attending the live (0167)
    let e = await eligibility(sister);
    expect(e.lectures).toMatchObject({ completed: 6, met: false });
    expect(e.eligible).toBe(false);
    await complete(sisterId, [aLectures[1]]);
    e = await eligibility(sister);
    expect(e.lectures).toMatchObject({ completed: 7, required: 7, met: true });
    expect(e.eligible).toBe(true);
  });

  test('a brother needs ⌈12 × 70 ⁄ 100⌉ = 9', async () => {
    await complete(brotherId, [...rootLectures]);
    expect((await eligibility(brother)).lectures).toMatchObject({ completed: 8, met: false });
    await complete(brotherId, [mLectures[0]]);
    const e = await eligibility(brother);
    expect(e.lectures).toMatchObject({ completed: 9, met: true });
    expect(e.eligible).toBe(true);
  });

  test("'all': every counted lecture", async () => {
    await saveSettings(admin, { enabled: true, lectureRule: 'all', pct: null, quizRule: 'none' });
    let e = await eligibility(sister);
    expect(e.lectures).toMatchObject({ rule: 'all', total: 10, completed: 7, required: 10, met: false });
    await complete(sisterId, rootLectures.slice(5));
    e = await eligibility(sister);
    expect(e.lectures).toMatchObject({ completed: 10, met: true });
    expect(e.eligible).toBe(true);
  });

  test('a section with no lectures never qualifies', async () => {
    const empty = await section(`تجربة قسم فارغ ${ts}`, null, 'all');
    expect((await saveSettings(admin, { enabled: true, lectureRule: 'all', pct: null, quizRule: 'none' }, empty)).error).toBeNull();
    const e = await eligibility(sister, undefined, empty);
    expect(e.lectures).toMatchObject({ total: 0, met: false });
    expect(e.eligible).toBe(false);
  });
});

describe('eligibility — quizzes', () => {
  test('required = the picks that are published (a draft pick waits), each passed on its own pass score', async () => {
    await saveSettings(admin, { enabled: true, lectureRule: 'all', pct: null, quizRule: 'selected', quizIds: [q1, q2, q3] });
    const e = await eligibility(sister);
    expect(e.lectures.met).toBe(true);
    expect(e.quizzes).toMatchObject({ rule: 'selected', required_count: 2, passed_count: 0, met: false });
    expect(e.eligible).toBe(false);
  });

  test('a failed attempt does not count; a pass does', async () => {
    await attempt(sisterId, q1, 1, { passed: false });
    expect((await eligibility(sister)).quizzes.passed_count).toBe(0);
    await attempt(sisterId, q1, 2, { passed: true });
    expect((await eligibility(sister)).quizzes.passed_count).toBe(1);
  });

  test('«بانتظار التصحيح» is not a pass until the grading is approved', async () => {
    const pending = await attempt(sisterId, q2, 1, { passed: null, grading_status: 'pending' });
    let e = await eligibility(sister);
    const item = (e.quizzes.items as any[]).find((i) => i.quiz_id === q2);
    expect(item).toMatchObject({ passed: false, pending_grading: true });
    expect(e.quizzes.met).toBe(false);
    expect(e.eligible).toBe(false);

    // the grader approves (what grade_quiz_attempt writes)
    const g = await service
      .from('quiz_attempts')
      .update({ grading_status: 'graded', passed: true, score: 1, graded_at: new Date().toISOString() })
      .eq('id', pending);
    expect(g.error).toBeNull();
    e = await eligibility(sister);
    expect(e.quizzes).toMatchObject({ required_count: 2, passed_count: 2, met: true });
    expect((e.quizzes.items as any[]).find((i) => i.quiz_id === q2).pending_grading).toBe(false);
    expect(e.eligible).toBe(true);
  });

  test('publishing the draft pick makes it a requirement', async () => {
    const fe = await service.from('quizzes').update({ status: 'published' }).eq('id', q3);
    expect(fe.error).toBeNull();
    const e = await eligibility(sister);
    expect(e.quizzes).toMatchObject({ required_count: 3, passed_count: 2, met: false });
    expect(e.eligible).toBe(false);
  });

  test("'none': quizzes are not required", async () => {
    await saveSettings(admin, { enabled: true, lectureRule: 'all', pct: null, quizRule: 'none', quizIds: [q1] });
    const e = await eligibility(sister);
    expect(e.quizzes).toMatchObject({ rule: 'none', required_count: 0, met: true });
    expect(e.eligible).toBe(true);
    const stored = await service.from('section_certificate_quizzes').select('quiz_id').eq('section_id', root);
    expect(stored.data).toHaveLength(0);
  });
});

describe('eligibility — access', () => {
  test("a student cannot ask about another student; staff can; anon cannot ask at all", async () => {
    const other = await brother.rpc('certificate_eligibility', { p_section: root, p_user: sisterId });
    expect(other.error!.message).toContain(DENIED);
    const staff = await eligibility(admin, sisterId);
    expect(staff.user_id).toBe(sisterId);
    expect(staff.eligible).toBe(true);
    const a = await anon.rpc('certificate_eligibility', { p_section: root, p_user: sisterId });
    expect(a.error).not.toBeNull();
    const svc = await eligibility(service, brotherId);
    expect(svc.user_id).toBe(brotherId);
  });
});
