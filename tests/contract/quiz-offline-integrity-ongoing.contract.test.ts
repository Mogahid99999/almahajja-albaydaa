/**
 * Contract tests for 0174 (offline finalize), 0175 (integrity statement) and
 * 0176 (ongoing sections), STAGING. Fixtures are «تجربة», removed in afterAll;
 * quizzes get a pre-marked fanout row, so nobody is notified.
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
  const email = `tajriba-offline-${++n}-${ts}@example.com`;
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

async function section(lectures = 1, seriesStatus: string | null = null) {
  const id = randomUUID();
  const ins = await service.from('sections').insert({ id, title: `تجربة مؤقت ${ts}-${sectionIds.length}`, parent_id: null, visibility: 'all', series_status: seriesStatus });
  if (ins.error) throw ins.error;
  sectionIds.push(id);
  const lectureIds: string[] = [];
  for (let i = 0; i < lectures; i++) {
    const lid = randomUUID();
    const l = await service.from('lectures').insert({ id: lid, section_id: id, title: `تجربة ${ts}-${id.slice(0, 4)}-${i}`, status: 'published', notify_on_publish: false, audio_path: `lectures/تجربة/of-${ts}-${id.slice(0, 4)}-${i}.mp3`, duration_sec: 60, order: i + 1 });
    if (l.error) throw l.error;
    lectureIds.push(lid);
  }
  return { id, lectureIds };
}

type Built = { id: string; mcq: { q: string; right: string; wrong: string }; text: string };

async function quiz(sectionId: string, kinds: ('mcq' | 'text')[], timeLimitSec: number | null = 600): Promise<Built> {
  const id = randomUUID();
  const f = await service.from('fanout_queue').insert({ kind: 'quiz', ref_id: id, params: { sent: true }, done_at: new Date().toISOString() });
  if (f.error) throw f.error;
  const z = await service.from('quizzes').insert({ id, section_id: sectionId, title: `تجربة ${ts}`, pass_score: 1, status: 'published', time_limit_sec: timeLimitSec });
  if (z.error) throw z.error;
  quizIds.push(id);
  const built: Built = { id, mcq: { q: '', right: '', wrong: '' }, text: '' };
  for (const [i, kind] of kinds.entries()) {
    const q = randomUUID();
    const r = await service.from('quiz_questions').insert({ id: q, quiz_id: id, text: `سؤال ${i}`, points: 1, order: i + 1, kind });
    if (r.error) throw r.error;
    if (kind === 'text') {
      built.text = q;
    } else {
      const right = randomUUID();
      const wrong = randomUUID();
      const o = await service.from('quiz_options').insert([
        { id: right, question_id: q, text: 'صح', is_correct: true, order: 1 },
        { id: wrong, question_id: q, text: 'خطأ', is_correct: false, order: 2 },
      ]);
      if (o.error) throw o.error;
      built.mcq = { q, right, wrong };
    }
  }
  return built;
}

const start = async (c: SupabaseClient, quizId: string, version?: number) =>
  c.rpc('start_quiz_attempt', { p_quiz_id: quizId, ...(version == null ? {} : { p_integrity_version: version }) });

async function begin(c: SupabaseClient, quizId: string, version?: number): Promise<string> {
  const { data, error } = await start(c, quizId, version);
  if (error) throw error;
  return data as string;
}

const finalize = (c: SupabaseClient, attempt: string, answers: unknown[]) =>
  c.rpc('finalize_quiz_attempt', { p_attempt_id: attempt, p_answers: answers });

const expire = async (attempt: string) => {
  const r = await service.from('quiz_attempts').update({ started_at: new Date(Date.now() - 3_600_000).toISOString() }).eq('id', attempt);
  if (r.error) throw r.error;
};

const attemptRow = async (id: string) => {
  const { data, error } = await service.from('quiz_attempts').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Record<string, unknown>;
};

async function certificate(sectionId: string, quizIdsRequired: string[], lectureRule = 'none', pct: number | null = null) {
  const a = await admin.rpc('set_section_certificate_settings', {
    p_section: sectionId, p_enabled: true, p_content_scope: 'section', p_lecture_rule: lectureRule,
    p_lecture_pct: pct, p_quiz_rule: quizIdsRequired.length ? 'selected' : 'none', p_quiz_ids: quizIdsRequired,
  });
  if (a.error) throw a.error;
  const b = await admin.rpc('set_section_certificate_details', {
    p_section: sectionId, p_certificate_title: null, p_author: null, p_presenter_name: 'الشيخ', p_presentation_form: 'بشرح', p_custom_text: null,
  });
  if (b.error) throw b.error;
}

const certsOf = async (userId: string, sectionId: string) => {
  const { data, error } = await service.from('certificates').select('id').eq('user_id', userId).eq('section_id', sectionId);
  if (error) throw error;
  return data!;
};
const noticesOf = async (userId: string) => {
  const { data } = await service.from('notifications').select('id').eq('user_id', userId).eq('type', 'certificate_issued');
  return data ?? [];
};
const passAttempt = async (quizId: string, userId: string) => {
  const a = await service.from('quiz_attempts').insert({ quiz_id: quizId, user_id: userId, attempt_no: 1, submitted_at: new Date().toISOString(), score: 1, passed: true });
  if (a.error) throw a.error;
};

async function until(check: () => Promise<boolean>, ms = 45_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

const setEnforced = async (on: boolean) => {
  const r = await service.from('app_config').upsert({ key: 'quiz_integrity_enforced', value: on ? 'true' : 'false' });
  if (r.error) throw r.error;
};

beforeAll(async () => {
  [admin] = await account('admin');
  await setEnforced(true);
}, 60000);

afterAll(async () => {
  await setEnforced(false);
  await service.from('certificates').delete().in('section_id', sectionIds);
  for (const id of quizIds) await service.from('fanout_queue').delete().eq('ref_id', id);
  for (const id of sectionIds) {
    await service.from('fanout_queue').delete().eq('ref_id', id);
    await service.from('sections').delete().eq('id', id);
  }
  for (const id of userIds) {
    await service.from('certificates').delete().eq('user_id', id);
    await service.auth.admin.deleteUser(id);
  }
}, 180000);

describe('0174 finalize', () => {
  test('MCQ answered offline past the deadline is graded once, however often it is sent', async () => {
    const s = await section(0);
    const q = await quiz(s.id, ['mcq']);
    const [c] = await account();
    const id = await begin(c, q.id);
    await expire(id);
    const refused = await c.rpc('save_quiz_answer', { p_attempt_id: id, p_question_id: q.mcq.q, p_option_id: q.mcq.right });
    expect(refused.error?.message).toContain('انتهى وقت الاختبار');

    const answers = [{ questionId: q.mcq.q, optionId: q.mcq.right }];
    const first = await finalize(c, id, answers);
    expect(first.error).toBeNull();
    const row = await attemptRow(id);
    expect(row).toMatchObject({ score: 1, passed: true, synced_offline: true });
    const stamp = row.submitted_at;

    // A retry with other answers changes nothing.
    await finalize(c, id, [{ questionId: q.mcq.q, optionId: q.mcq.wrong }]);
    expect(await attemptRow(id)).toMatchObject({ score: 1, passed: true, submitted_at: stamp });
    const { data } = await service.from('quiz_attempt_answers').select('option_id').eq('attempt_id', id);
    expect(data).toEqual([{ option_id: q.mcq.right }]);
    const { count } = await service.from('quiz_attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', q.id);
    expect(count).toBe(1);
  }, 60000);

  test('two simultaneous sends make one submission', async () => {
    const s = await section(0);
    const q = await quiz(s.id, ['mcq']);
    const [c] = await account();
    const id = await begin(c, q.id);
    const answers = [{ questionId: q.mcq.q, optionId: q.mcq.right }];
    const both = await Promise.all([finalize(c, id, answers), finalize(c, id, answers)]);
    expect(both.every((r) => r.error === null)).toBe(true);
    expect(await attemptRow(id)).toMatchObject({ score: 1, synced_offline: false });
  }, 60000);

  test('written and mixed wait for a grader, with the answers kept', async () => {
    const s = await section(0);
    const written = await quiz(s.id, ['text']);
    const mixed = await quiz(s.id, ['mcq', 'text']);
    const [c] = await account();
    const w = await begin(c, written.id);
    await finalize(c, w, [{ questionId: written.text, text: 'إجابة كتابية' }]);
    expect(await attemptRow(w)).toMatchObject({ grading_status: 'pending', score: null, passed: null });
    const m = await begin(c, mixed.id);
    await finalize(c, m, [{ questionId: mixed.mcq.q, optionId: mixed.mcq.right }, { questionId: mixed.text, text: 'شرح' }]);
    expect(await attemptRow(m)).toMatchObject({ grading_status: 'pending' });
    const { data } = await service.from('quiz_attempt_answers').select('text_answer, option_id').eq('attempt_id', m);
    expect(data).toHaveLength(2);
  }, 60000);

  test('unanswered stays unanswered; junk and foreign ids are skipped, not fatal', async () => {
    const s = await section(0);
    const q = await quiz(s.id, ['mcq']);
    const other = await quiz(s.id, ['mcq']);
    const [c] = await account();
    const id = await begin(c, q.id);
    const r = await finalize(c, id, [{ questionId: 'nonsense' }, { questionId: other.mcq.q, optionId: other.mcq.right }, { questionId: q.mcq.q, optionId: other.mcq.right }]);
    expect(r.error).toBeNull();
    expect(await attemptRow(id)).toMatchObject({ score: 0, passed: false });
    const { data } = await service.from('quiz_attempt_answers').select('question_id').eq('attempt_id', id);
    expect(data).toEqual([]);
  }, 60000);

  test("another student cannot finish someone's attempt", async () => {
    const s = await section(0);
    const q = await quiz(s.id, ['mcq']);
    const [c] = await account();
    const [other] = await account();
    const id = await begin(c, q.id);
    const r = await finalize(other, id, []);
    expect(r.error?.message).toContain('المحاولة غير موجودة');
    expect((await attemptRow(id)).submitted_at).toBeNull();
  }, 60000);

  test('a quiz with no time limit is never marked late', async () => {
    const s = await section(0);
    const q = await quiz(s.id, ['mcq'], null);
    const [c] = await account();
    const id = await begin(c, q.id);
    await expire(id);
    await finalize(c, id, [{ questionId: q.mcq.q, optionId: q.mcq.right }]);
    expect(await attemptRow(id)).toMatchObject({ score: 1, synced_offline: false });
  }, 60000);
});

describe('0175 integrity', () => {
  test('an ordinary quiz, even inside a certificate section, needs no statement', async () => {
    const s = await section(1);
    const required = await quiz(s.id, ['mcq']);
    const plain = await quiz(s.id, ['mcq']);
    await certificate(s.id, [required.id]);
    const [c] = await account();
    expect((await c.rpc('get_quiz_integrity', { p_quiz_id: plain.id })).data).toBeNull();
    const id = await begin(c, plain.id);
    expect(await attemptRow(id)).toMatchObject({ integrity_version: null, integrity_accepted_at: null });
  }, 60000);

  test('a required quiz cannot start without the current version; acceptance is stored', async () => {
    const s = await section(1);
    const q = await quiz(s.id, ['mcq']);
    await certificate(s.id, [q.id]);
    const [c] = await account();
    const statement = (await c.rpc('get_quiz_integrity', { p_quiz_id: q.id })).data as { version: number; body: string };
    expect(statement.body).toContain('أُقرّ بأنني سأؤدي');

    expect((await start(c, q.id)).error?.message).toContain('إقرار النزاهة');
    expect((await start(c, q.id, statement.version + 7)).error?.message).toContain('إقرار النزاهة');
    const direct = await c.from('quiz_attempts').insert({ quiz_id: q.id, user_id: (await c.auth.getUser()).data.user!.id, attempt_no: 1 });
    expect(direct.error).not.toBeNull();

    const id = await begin(c, q.id, statement.version);
    const row = await attemptRow(id);
    expect(row.integrity_version).toBe(statement.version);
    expect(row.integrity_accepted_at).toBeTruthy();

    // Resuming needs nothing new, and is the same attempt.
    expect(await begin(c, q.id)).toBe(id);
  }, 60000);

  test('switch off: a build that sends no version still starts, and a new one is recorded', async () => {
    const s = await section(1);
    const q = await quiz(s.id, ['mcq']);
    const other = await quiz(s.id, ['mcq']);
    await certificate(s.id, [q.id, other.id]);
    await setEnforced(false);
    try {
      const [oldBuild] = await account();
      const id = await begin(oldBuild, q.id);
      expect(await attemptRow(id)).toMatchObject({ integrity_version: null, integrity_accepted_at: null });
      const [newBuild] = await account();
      const accepted = await begin(newBuild, q.id, 1);
      expect((await attemptRow(accepted)).integrity_version).toBe(1);
      expect((await start(newBuild, other.id, 99)).error?.message).toContain('إقرار النزاهة');
    } finally {
      await setEnforced(true);
    }
  }, 60000);

  test('the statement cannot be read or edited directly', async () => {
    const [c] = await account();
    expect((await c.from('quiz_integrity_statements').select('*')).error).not.toBeNull();
  }, 60000);

  test('a disabled certificate no longer asks for it', async () => {
    const s = await section(1);
    const q = await quiz(s.id, ['mcq']);
    await certificate(s.id, [q.id]);
    const off = await service.from('section_certificate_settings').update({ enabled: false }).eq('section_id', s.id);
    expect(off.error).toBeNull();
    const [c] = await account();
    expect((await start(c, q.id)).error).toBeNull();
  }, 60000);
});

describe('0176 ongoing', () => {
  const complete = async (uid: string, lectureId: string) => {
    const r = await service.from('user_lecture_progress').upsert({ user_id: uid, lecture_id: lectureId, position_sec: 60, completed: true });
    if (r.error) throw r.error;
  };

  test('ongoing blocks lectures, quizzes and no-lecture rule; finishing issues once, with no new activity', async () => {
    const all = await section(2, 'ongoing');
    await certificate(all.id, [], 'all');
    const none = await section(1, 'ongoing');
    const q = await quiz(none.id, ['mcq']);
    await certificate(none.id, [q.id]);
    const [c, uid] = await account();
    for (const l of all.lectureIds) await complete(uid, l);
    await passAttempt(q.id, uid);

    for (const s of [all, none]) {
      const { data: e } = await c.rpc('certificate_eligibility', { p_section: s.id, p_user: null });
      expect(e).toMatchObject({ series_ongoing: true, eligible: false, enabled: true });
      expect((e as { lectures: { met: boolean }; quizzes: { met: boolean } }).lectures.met).toBe(true);
      expect((e as { quizzes: { met: boolean } }).quizzes.met).toBe(true);
    }
    const { data: list } = await c.rpc('get_my_certificates');
    expect((list as { section_id: string }[]).filter((r) => ([all.id, none.id] as string[]).includes(r.section_id))).toHaveLength(2);
    expect(await certsOf(uid, all.id)).toHaveLength(0);
    expect(await certsOf(uid, none.id)).toHaveLength(0);
    expect(await noticesOf(uid)).toHaveLength(0);

    for (const s of [all, none]) {
      const up = await service.from('sections').update({ series_status: 'completed' }).eq('id', s.id);
      expect(up.error).toBeNull();
    }
    const issued = await until(async () => (await certsOf(uid, all.id)).length === 1 && (await certsOf(uid, none.id)).length === 1, 60_000);
    expect(issued).toBe(true);
    await c.rpc('get_my_certificates');
    expect(await certsOf(uid, all.id)).toHaveLength(1);
    expect(await noticesOf(uid)).toHaveLength(2);
  }, 150000);

  test('a student who has not met the conditions gets nothing when it finishes', async () => {
    const s = await section(2, 'ongoing');
    await certificate(s.id, [], 'all');
    const [, uid] = await account();
    await complete(uid, s.lectureIds[0]);
    await service.from('sections').update({ series_status: 'completed' }).eq('id', s.id);
    const done = await until(async () => {
      const { data } = await service.from('fanout_queue').select('done_at').eq('kind', 'certificates').eq('ref_id', s.id).single();
      return !!data?.done_at;
    }, 60_000);
    expect(done).toBe(true);
    expect(await certsOf(uid, s.id)).toHaveLength(0);
  }, 120000);

  test('finished and unset sections issue as before', async () => {
    for (const status of ['completed', null]) {
      const s = await section(1, status);
      await certificate(s.id, [], 'all');
      const [, uid] = await account();
      await complete(uid, s.lectureIds[0]);
      expect(await certsOf(uid, s.id)).toHaveLength(1);
    }
  }, 90000);

  test('a certificate already issued survives the section going back to ongoing', async () => {
    const s = await section(1, 'completed');
    await certificate(s.id, [], 'all');
    const [c, uid] = await account();
    await complete(uid, s.lectureIds[0]);
    const before = await certsOf(uid, s.id);
    await service.from('sections').update({ series_status: 'ongoing' }).eq('id', s.id);
    expect(await certsOf(uid, s.id)).toEqual(before);
    const { data: list } = await c.rpc('get_my_certificates');
    const row = (list as { section_id: string; issued: { id: string } | null }[]).find((r) => r.section_id === s.id);
    expect(row?.issued?.id).toBe(before[0].id);
  }, 60000);
});
