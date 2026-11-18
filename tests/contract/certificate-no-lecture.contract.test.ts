/**
 * Contract tests for 0173 «بدون شرط للمحاضرات», STAGING. All fixtures are «تجربة»
 * and removed in afterAll; quizzes get a pre-marked fanout row, so nobody is notified.
 */
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ts = Date.now();
const sectionIds: string[] = [];
const userIds: string[] = [];
const quizIds: string[] = [];
let admin: SupabaseClient;
let n = 0;

async function account(role?: string): Promise<[SupabaseClient, string]> {
  const email = `tajriba-nolec-${++n}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('no user');
  userIds.push(data.user.id);
  const up = await service.from('profiles').update({ display_name: 'تجربة طالب', gender: 'male', ...(role ? { role } : {}) }).eq('id', data.user.id);
  if (up.error) throw up.error;
  const c = createClient(url, anonKey, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return [c, data.user.id];
}

async function section(lectures = 3) {
  const id = randomUUID();
  const ins = await service.from('sections').insert({ id, title: `تجربة بلا شرط ${ts}-${sectionIds.length}`, parent_id: null, visibility: 'all' });
  if (ins.error) throw ins.error;
  sectionIds.push(id);
  const lectureIds: string[] = [];
  for (let i = 0; i < lectures; i++) {
    const lid = randomUUID();
    const l = await service.from('lectures').insert({ id: lid, section_id: id, title: `تجربة ${ts}-${id.slice(0, 4)}-${i}`, status: 'published', notify_on_publish: false, audio_path: `lectures/تجربة/nolec-${ts}-${id.slice(0, 4)}-${i}.mp3`, duration_sec: 60, order: i + 1 });
    if (l.error) throw l.error;
    lectureIds.push(lid);
  }
  return { id, lectureIds };
}

async function quiz(sectionId: string, status: 'published' | 'draft' = 'published') {
  const id = randomUUID();
  const f = await service.from('fanout_queue').insert({ kind: 'quiz', ref_id: id, params: { sent: true }, done_at: new Date().toISOString() });
  if (f.error) throw f.error;
  const q = await service.from('quizzes').insert({ id, section_id: sectionId, title: `تجربة ${ts}`, pass_score: 1, status });
  if (q.error) throw q.error;
  quizIds.push(id);
  return id;
}

const save = (sectionId: string, enabled: boolean, lectureRule: string, quizRule: string, ids: string[] = [], pct: number | null = null) =>
  admin.rpc('set_section_certificate_settings', {
    p_section: sectionId, p_enabled: enabled, p_content_scope: 'section', p_lecture_rule: lectureRule,
    p_lecture_pct: pct, p_quiz_rule: quizRule, p_quiz_ids: ids,
  });

async function enable(sectionId: string, ids: string[]) {
  const a = await save(sectionId, true, 'none', 'selected', ids);
  if (a.error) throw a.error;
  const b = await admin.rpc('set_section_certificate_details', {
    p_section: sectionId, p_certificate_title: null, p_author: null, p_presenter_name: 'فضيلة الشيخ النذير محمد فرح',
    p_presentation_form: 'بشرح', p_custom_text: null,
  });
  if (b.error) throw b.error;
}

async function pass(quizId: string, userId: string, attempt = 1) {
  const a = await service.from('quiz_attempts').insert({ quiz_id: quizId, user_id: userId, attempt_no: attempt, submitted_at: new Date().toISOString(), score: 1, passed: true });
  if (a.error) throw a.error;
}

const certsOf = async (userId: string, sectionId: string) => {
  const { data, error } = await service.from('certificates').select('id').eq('user_id', userId).eq('section_id', sectionId);
  if (error) throw error;
  return data!;
};
const eligibility = async (c: SupabaseClient, sectionId: string) => {
  const { data, error } = await c.rpc('certificate_eligibility', { p_section: sectionId, p_user: null });
  if (error) throw error;
  return data as any;
};
const listed = async (c: SupabaseClient, sectionId: string) => {
  const { data, error } = await c.rpc('get_my_certificates');
  if (error) throw error;
  return (data as any[]).find((r) => r.section_id === sectionId);
};

beforeAll(async () => {
  [admin] = await account('admin');
}, 60000);

afterAll(async () => {
  await service.from('certificates').delete().in('section_id', sectionIds);
  for (const id of quizIds) await service.from('fanout_queue').delete().eq('ref_id', id);
  for (const id of sectionIds) await service.from('sections').delete().eq('id', id);
  for (const id of userIds) {
    await service.from('certificates').delete().eq('user_id', id);
    await service.auth.admin.deleteUser(id);
  }
}, 120000);

test('one quiz: lectures are ignored, issued as soon as it is passed', async () => {
  const s = await section(10);
  const q = await quiz(s.id);
  await enable(s.id, [q]);
  const [c, uid] = await account();

  const before = await eligibility(c, s.id);
  expect(before.eligible).toBe(false);
  expect(before.lectures).toMatchObject({ rule: 'none', pct: null, total: 0, completed: 0, required: 0, completed_pct: 0, met: true });
  expect(before.quizzes).toMatchObject({ required_count: 1, passed_count: 0, met: false });
  expect(await listed(c, s.id)).toBeTruthy();

  await pass(q, uid);
  expect(await certsOf(uid, s.id)).toHaveLength(1);
  expect((await eligibility(c, s.id)).eligible).toBe(true);
}, 60000);

test('several quizzes: only when the last one is passed', async () => {
  const s = await section();
  const [q1, q2] = [await quiz(s.id), await quiz(s.id)];
  await enable(s.id, [q1, q2]);
  const [, uid] = await account();
  await pass(q1, uid);
  expect(await certsOf(uid, s.id)).toHaveLength(0);
  await pass(q2, uid);
  expect(await certsOf(uid, s.id)).toHaveLength(1);
}, 60000);

test('a written quiz: pending is not passed, approval issues', async () => {
  const s = await section();
  const q = await quiz(s.id);
  await enable(s.id, [q]);
  const [c, uid] = await account();
  const a = await service.from('quiz_attempts').insert({ quiz_id: q, user_id: uid, attempt_no: 1, submitted_at: new Date().toISOString(), grading_status: 'pending' }).select('id').single();
  expect(a.error).toBeNull();
  const pending = await eligibility(c, s.id);
  expect(pending.eligible).toBe(false);
  expect(pending.quizzes.items[0]).toMatchObject({ passed: false, pending_grading: true });
  expect(await certsOf(uid, s.id)).toHaveLength(0);
  const g = await service.from('quiz_attempts').update({ grading_status: 'graded', passed: true, score: 1 }).eq('id', a.data!.id);
  expect(g.error).toBeNull();
  expect(await certsOf(uid, s.id)).toHaveLength(1);
}, 60000);

test('a section with no lecture still works when the quiz is the condition', async () => {
  const s = await section(0);
  const q = await quiz(s.id);
  await enable(s.id, [q]);
  const [c, uid] = await account();
  expect(await listed(c, s.id)).toBeTruthy();
  await pass(q, uid);
  expect(await certsOf(uid, s.id)).toHaveLength(1);
}, 60000);

test('no condition at all can never be enabled', async () => {
  const s = await section();
  const none = await save(s.id, true, 'none', 'none');
  expect(none.error?.message).toContain('شرطًا واحدًا على الأقل');

  const draft = await quiz(s.id, 'draft');
  const onlyDraft = await save(s.id, true, 'none', 'selected', [draft]);
  expect(onlyDraft.error?.message).toContain('منشورًا');

  const off = await save(s.id, false, 'none', 'none');
  expect(off.error).toBeNull();

  // The table refuses it even past the function.
  const direct = await service.from('section_certificate_settings').update({ enabled: true }).eq('section_id', s.id);
  expect(direct.error?.message).toContain('section_certificate_settings_has_condition');

  const [c, uid] = await account();
  await c.rpc('get_my_certificates');
  expect(await certsOf(uid, s.id)).toHaveLength(0);
}, 60000);

test('required quizzes later drafted: earned by nobody, not listed', async () => {
  const s = await section();
  const q = await quiz(s.id);
  await enable(s.id, [q]);
  const up = await service.from('quizzes').update({ status: 'draft' }).eq('id', q);
  expect(up.error).toBeNull();
  const [c, uid] = await account();
  const e = await eligibility(c, s.id);
  expect(e.quizzes.required_count).toBe(0);
  expect(e.eligible).toBe(false);
  expect(await listed(c, s.id)).toBeUndefined();
  expect(await certsOf(uid, s.id)).toHaveLength(0);
}, 60000);

test('issued once: one certificate and one notice however often it runs', async () => {
  const s = await section();
  const q = await quiz(s.id);
  await enable(s.id, [q]);
  const [c, uid] = await account();
  await pass(q, uid, 1);
  await pass(q, uid, 2);
  await c.rpc('get_my_certificates');
  await c.rpc('get_my_certificates');
  expect(await certsOf(uid, s.id)).toHaveLength(1);
  const { data } = await service.from('notifications').select('id').eq('user_id', uid).eq('type', 'certificate_issued');
  expect(data).toHaveLength(1);
}, 60000);

test('existing rules keep their meaning: 70 % and 100 %', async () => {
  const pctSection = await section(10);
  expect((await save(pctSection.id, true, 'percent', 'none', [], 70)).error).toBeNull();
  const [c, uid] = await account();
  const complete = async (id: string) => {
    const r = await service.from('user_lecture_progress').upsert({ user_id: uid, lecture_id: id, position_sec: 60, completed: true });
    if (r.error) throw r.error;
  };
  for (const id of pctSection.lectureIds.slice(0, 6)) await complete(id);
  let e = await eligibility(c, pctSection.id);
  expect(e.lectures).toMatchObject({ rule: 'percent', pct: 70, total: 10, completed: 6, required: 7, met: false });
  await complete(pctSection.lectureIds[6]);
  e = await eligibility(c, pctSection.id);
  expect(e.lectures).toMatchObject({ required: 7, met: true });
  expect(e.eligible).toBe(true);

  const allSection = await section(2);
  expect((await save(allSection.id, true, 'all', 'none')).error).toBeNull();
  await complete(allSection.lectureIds[0]);
  e = await eligibility(c, allSection.id);
  expect(e.lectures).toMatchObject({ rule: 'all', pct: null, total: 2, completed: 1, required: 2, met: false });
  expect(e.eligible).toBe(false);
  await complete(allSection.lectureIds[1]);
  expect((await eligibility(c, allSection.id)).eligible).toBe(true);
}, 90000);
