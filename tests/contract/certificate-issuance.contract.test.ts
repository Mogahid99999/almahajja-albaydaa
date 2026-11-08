/**
 * Contract tests for 0170 (issuing, snapshot, access), STAGING.
 * Students and sections are throwaway («تجربة») and removed in afterAll.
 * Needs template v1 active. The worker may render these rows; that is harmless.
 */
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service: SupabaseClient = createClient(url, serviceKey, opts);
const anon: SupabaseClient = createClient(url, anonKey, opts);

const ts = Date.now();
const sectionIds: string[] = [];
const userIds: string[] = [];
const quizIds: string[] = [];
let admin: SupabaseClient;

const ID_RE = /^MAH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

async function student(label: string, name: string, gender = 'male'): Promise<[SupabaseClient, string]> {
  const email = `tajriba-issue-${label}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: name },
  });
  if (error || !data.user) throw error ?? new Error('no user');
  userIds.push(data.user.id);
  const up = await service.from('profiles').update({ display_name: name, gender }).eq('id', data.user.id);
  if (up.error) throw up.error;
  const c = createClient(url, anonKey, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return [c, data.user.id];
}

async function section(title: string, details: Record<string, unknown>, lectures: number, quizId?: () => Promise<string>) {
  const id = randomUUID();
  const ins = await service.from('sections').insert({ id, title, parent_id: null, visibility: 'all' });
  if (ins.error) throw ins.error;
  sectionIds.push(id);
  const lectureIds: string[] = [];
  for (let i = 0; i < lectures; i++) {
    const lid = randomUUID();
    const l = await service.from('lectures').insert({ id: lid, section_id: id, title: `تجربة ${ts}-${id.slice(0, 4)}-${i}`, status: 'published', audio_path: `lectures/تجربة/issue-${ts}-${id.slice(0, 4)}-${i}.mp3`, duration_sec: 60, order: i + 1 });
    if (l.error) throw l.error;
    lectureIds.push(lid);
  }
  const qid = quizId ? await quizId() : null;
  void qid;
  return { id, lectureIds, details };
}

async function makeQuiz(sectionId: string) {
  const { data, error } = await service
    .from('quizzes')
    .insert({ section_id: sectionId, title: `تجربة ${ts}`, status: 'published', pass_score: 1 })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('no quiz');
  quizIds.push(data.id);
  return data.id as string;
}

async function configure(sectionId: string, details: Record<string, unknown>, quizIds_: string[] = []) {
  const a = await admin.rpc('set_section_certificate_settings', {
    p_section: sectionId, p_enabled: true, p_content_scope: 'section', p_lecture_rule: 'all',
    p_lecture_pct: null, p_quiz_rule: quizIds_.length ? 'selected' : 'none', p_quiz_ids: quizIds_,
  });
  if (a.error) throw a.error;
  const b = await admin.rpc('set_section_certificate_details', {
    p_section: sectionId, p_certificate_title: null, p_author: null, p_presenter_name: 'فضيلة الشيخ النذير محمد فرح',
    p_presentation_form: 'بشرح', p_custom_text: null, ...details,
  });
  if (b.error) throw b.error;
}

async function complete(userId: string, lectureId: string) {
  const { error } = await service.from('user_lecture_progress').upsert({ user_id: userId, lecture_id: lectureId, position_sec: 60, completed: true });
  if (error) throw error;
}

const certsOf = async (userId: string, sectionId: string) => {
  const { data, error } = await service.from('certificates').select('*').eq('user_id', userId).eq('section_id', sectionId);
  if (error) throw error;
  return data!;
};
const noticesOf = async (userId: string) => {
  const { data, error } = await service.from('notifications').select('*').eq('user_id', userId).eq('type', 'certificate_issued');
  if (error) throw error;
  return data!;
};

beforeAll(async () => {
  admin = createClient(url, anonKey, opts);
  const email = `tajriba-issue-admin-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error;
  userIds.push(data.user.id);
  const up = await service.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
  if (up.error) throw up.error;
  const s = await admin.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
}, 60000);

afterAll(async () => {
  await service.from('certificates').delete().in('section_id', sectionIds);
  for (const id of quizIds) await service.from('quizzes').delete().eq('id', id);
  for (const id of sectionIds) await service.from('sections').delete().eq('id', id);
  for (const id of userIds) {
    await service.from('certificates').delete().eq('user_id', id);
    await service.auth.admin.deleteUser(id);
  }
}, 120000);

describe('issuing', () => {
  test('a book explanation: issued on the last lecture only, with the full snapshot', async () => {
    const s = await section(`تجربة كتاب ${ts}`, {}, 2);
    await configure(s.id, { p_certificate_title: 'كتاب التوحيد', p_author: 'الإمام محمد بن عبد الوهاب رحمه الله' });
    const [, uid] = await student('book', 'أحمد تجربة');

    await complete(uid, s.lectureIds[0]);
    expect(await certsOf(uid, s.id)).toHaveLength(0);   // not eligible yet

    await complete(uid, s.lectureIds[1]);
    const rows = await certsOf(uid, s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(ID_RE);
    expect(rows[0].status).toBe('valid');
    expect(rows[0].template_version).toBeGreaterThan(0);
    expect(rows[0].snapshot).toMatchObject({
      student_name: 'أحمد تجربة',
      title: 'كتاب التوحيد',
      author_line: 'للإمام محمد بن عبد الوهاب رحمه الله',
      presenter_line: 'بشرح فضيلة الشيخ النذير محمد فرح',
    });
    expect(rows[0].snapshot.verification_url).toMatch(new RegExp(`/c/${rows[0].id}$`));
  }, 60000);

  test('no author: no author line; the wording follows the form', async () => {
    const s = await section(`قصص ${ts}`, {}, 1);
    await configure(s.id, { p_certificate_title: 'قصص الأنبياء', p_presentation_form: 'تقديم' });
    const [, uid] = await student('story', 'فاطمة تجربة', 'female');
    await complete(uid, s.lectureIds[0]);
    const [c] = await certsOf(uid, s.id);
    expect(c.snapshot.author_line).toBeNull();
    expect(c.snapshot.presenter_line).toBe('تقديم فضيلة الشيخ النذير محمد فرح');
    expect(c.snapshot.gender).toBe('female');
  }, 60000);

  test('no second certificate, no second notification, on re-runs', async () => {
    const s = await section(`تكرار ${ts}`, {}, 1);
    await configure(s.id, {});
    const [c, uid] = await student('twice', 'تجربة تكرار');
    await complete(uid, s.lectureIds[0]);
    const [first] = await certsOf(uid, s.id);

    // the completion again, then the catch-up path, then in parallel
    const reset = await service.from('user_lecture_progress').update({ completed: false }).eq('user_id', uid);
    expect(reset.error).toBeNull();
    await complete(uid, s.lectureIds[0]);
    await Promise.all([c.rpc('get_my_certificates'), c.rpc('get_my_certificates'), c.rpc('get_my_certificates')]);

    const rows = await certsOf(uid, s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    const notices = await noticesOf(uid);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('مبارك لك 🎉 تم إصدار شهادة إتمامك');
    expect(notices[0].data.route).toBe(`/certificate/${first.id}`);
  }, 60000);

  test('a guest never gets one', async () => {
    const s = await section(`ضيف ${ts}`, {}, 1);
    await configure(s.id, {});
    const c = createClient(url, anonKey, opts);
    const { data, error } = await c.auth.signInAnonymously();
    if (error || !data.user) throw error;
    userIds.push(data.user.id);
    await complete(data.user.id, s.lectureIds[0]);
    expect(await certsOf(data.user.id, s.id)).toHaveLength(0);
  }, 60000);

  test('a passed quiz can be the last condition', async () => {
    const s = await section(`اختبار ${ts}`, {}, 1);
    const quiz = await makeQuiz(s.id);
    await configure(s.id, {}, [quiz]);
    const [, uid] = await student('quiz', 'تجربة اختبار');
    await complete(uid, s.lectureIds[0]);
    expect(await certsOf(uid, s.id)).toHaveLength(0);
    const a = await service.from('quiz_attempts').insert({
      quiz_id: quiz, user_id: uid, attempt_no: 1, submitted_at: new Date().toISOString(), score: 1, passed: true,
    });
    expect(a.error).toBeNull();
    expect(await certsOf(uid, s.id)).toHaveLength(1);
  }, 60000);

  test('a written quiz: nothing while awaiting grading, issued on approval', async () => {
    const s = await section(`كتابي ${ts}`, {}, 1);
    const quiz = await makeQuiz(s.id);
    await configure(s.id, {}, [quiz]);
    const [, uid] = await student('written', 'تجربة كتابي');
    await complete(uid, s.lectureIds[0]);
    const a = await service.from('quiz_attempts').insert({
      quiz_id: quiz, user_id: uid, attempt_no: 1, submitted_at: new Date().toISOString(), grading_status: 'pending',
    }).select('id').single();
    expect(a.error).toBeNull();
    expect(await certsOf(uid, s.id)).toHaveLength(0);
    const g = await service.from('quiz_attempts').update({ grading_status: 'graded', passed: true, score: 1 }).eq('id', a.data!.id);
    expect(g.error).toBeNull();
    expect(await certsOf(uid, s.id)).toHaveLength(1);
  }, 60000);

  test('catch-up: enabled after the student had finished', async () => {
    const s = await section(`لاحقًا ${ts}`, {}, 1);
    const [c, uid] = await student('late', 'تجربة لاحق');
    await complete(uid, s.lectureIds[0]);
    await configure(s.id, {});
    expect(await certsOf(uid, s.id)).toHaveLength(0);
    const { data, error } = await c.rpc('get_my_certificates');
    expect(error).toBeNull();
    const row = (data as any[]).find((r) => r.section_id === s.id);
    expect(row.issued.id).toMatch(ID_RE);
  }, 60000);
});

describe('history', () => {
  test('later changes never reach an issued certificate', async () => {
    const s = await section(`ثبات ${ts}`, {}, 1);
    await configure(s.id, { p_certificate_title: 'العنوان الأصلي', p_author: 'مؤلف أصلي' });
    const [c, uid] = await student('frozen', 'الاسم الأصلي');
    await complete(uid, s.lectureIds[0]);
    const [before] = await certsOf(uid, s.id);

    await configure(s.id, { p_certificate_title: 'عنوان جديد', p_author: null, p_presenter_name: 'شيخ آخر', p_presentation_form: 'تقديم' });
    await service.from('profiles').update({ display_name: 'اسم جديد' }).eq('id', uid);
    await service.from('sections').update({ title: 'قسم جديد' }).eq('id', s.id);
    await admin.rpc('set_section_certificate_settings', {
      p_section: s.id, p_enabled: true, p_content_scope: 'section', p_lecture_rule: 'percent',
      p_lecture_pct: 50, p_quiz_rule: 'none', p_quiz_ids: [],
    });

    const [after] = await certsOf(uid, s.id);
    expect(after.snapshot).toEqual(before.snapshot);

    // disabling keeps it in «شهاداتي»
    await admin.rpc('set_section_certificate_settings', {
      p_section: s.id, p_enabled: false, p_content_scope: 'section', p_lecture_rule: 'all',
      p_lecture_pct: null, p_quiz_rule: 'none', p_quiz_ids: [],
    });
    const { data } = await c.rpc('get_my_certificates');
    const row = (data as any[]).find((r) => r.section_id === s.id);
    expect(row.issued.title).toBe('العنوان الأصلي');
  }, 60000);

  test('the snapshot resists even the service role; a template cannot be rewritten', async () => {
    const s = await section(`حماية ${ts}`, {}, 1);
    await configure(s.id, {});
    const [, uid] = await student('guard', 'تجربة حماية');
    await complete(uid, s.lectureIds[0]);
    const [c] = await certsOf(uid, s.id);
    const u = await service.from('certificates').update({ snapshot: { student_name: 'مزور' } }).eq('id', c.id);
    expect(u.error?.message).toContain('لا تتغير');
    const t = await service.from('certificate_templates').update({ html: 'x' }).eq('version', c.template_version);
    expect(t.error?.message).toContain('إصدارًا جديدًا');
  }, 60000);

  test('account deletion voids the certificate and erases the name', async () => {
    const s = await section(`حذف ${ts}`, {}, 1);
    await configure(s.id, {});
    const [, uid] = await student('gone', 'تجربة محذوف');
    await complete(uid, s.lectureIds[0]);
    const [c] = await certsOf(uid, s.id);
    await service.auth.admin.deleteUser(uid);
    const { data } = await service.from('certificates').select('status,snapshot').eq('id', c.id).single();
    expect(data!.status).toBe('void');
    expect(data!.snapshot.student_name).toBeUndefined();
    const v = await service.rpc('verify_certificate', { p_id: c.id });
    expect(v.data).toBeNull();
  }, 60000);
});

describe('access', () => {
  let owner: SupabaseClient;
  let other: SupabaseClient;
  let certId = '';

  beforeAll(async () => {
    const s = await section(`وصول ${ts}`, {}, 1);
    await configure(s.id, {});
    let uid = '';
    [owner, uid] = await student('owner', 'تجربة مالك');
    [other] = await student('other', 'تجربة آخر');
    await complete(uid, s.lectureIds[0]);
    certId = (await certsOf(uid, s.id))[0].id;
  }, 60000);

  test('tables are closed to clients', async () => {
    for (const c of [anon, owner]) {
      const a = await c.from('certificates').select('id');
      expect(a.error).not.toBeNull();
      const b = await c.from('certificate_templates').select('version');
      expect(b.error).not.toBeNull();
    }
  });

  test.each(['verify_certificate', 'certificate_files_for', 'claim_certificate_renders', 'issue_certificate_if_eligible'])(
    '%s is not callable by clients', async (fn) => {
      const args: Record<string, Record<string, unknown>> = {
        verify_certificate: { p_id: certId },
        certificate_files_for: { p_id: certId, p_user: randomUUID() },
        claim_certificate_renders: { p_limit: 1 },
        issue_certificate_if_eligible: { p_section: randomUUID(), p_user: randomUUID() },
      };
      for (const c of [anon, owner, admin]) {
        const { error } = await c.rpc(fn, args[fn]);
        expect(error).not.toBeNull();
      }
    });

  test('only the owner reads it', async () => {
    const mine = await owner.rpc('get_my_certificate', { p_id: certId });
    expect(mine.data.id).toBe(certId);
    const theirs = await other.rpc('get_my_certificate', { p_id: certId });
    expect(theirs.data).toBeNull();
    expect(JSON.stringify(mine.data)).not.toContain('certificates/');   // no storage keys
  });

  test('settings details: staff only, presenter required once enabled', async () => {
    const s = await section(`إعداد ${ts}`, {}, 1);
    await configure(s.id, {});
    const denied = await other.rpc('set_section_certificate_details', {
      p_section: s.id, p_certificate_title: 'x', p_author: null, p_presenter_name: 'x', p_presentation_form: 'x', p_custom_text: null,
    });
    expect(denied.error?.code).toBe('42501');
    const blank = await admin.rpc('set_section_certificate_details', {
      p_section: s.id, p_certificate_title: 'x', p_author: null, p_presenter_name: '  ', p_presentation_form: 'x', p_custom_text: null,
    });
    expect(blank.error?.message).toContain('مقدم المادة');
  }, 60000);
});
