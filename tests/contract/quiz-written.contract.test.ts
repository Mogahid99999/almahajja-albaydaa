/**
 * Contract tests for migration 0166 (أسئلة «إجابة نصية» + التصحيح اليدوي)
 * against STAGING. Every assertion runs through the anon key with real
 * sessions (RLS + the DEFINER gates are what is under test); the service key
 * only creates/deletes the throwaway accounts, section and quizzes.
 *
 * Invariants:
 *  - an MCQ-only quiz still grades on submit (no grading status, counts as before);
 *  - a mixed quiz: text answers saved/resumed, submit → 'pending', no score / pass
 *    / model answer reaches the student, no new attempt while pending;
 *  - admin, sheikh and publisher can grade; a plain student cannot;
 *  - a grade outside 0..points, or an incomplete grading, is refused;
 *  - approval writes score = MCQ + written, passed vs pass_score, grader + time,
 *    and a personal «تم تصحيح اختبارك ✓» inbox row routing to this attempt;
 *  - the note shows to the student; the model answer only with show_correct_answers.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const svc = createClient(url, serviceKey, opts);

const stamp = Date.now();
const password = `Contract-${stamp}-q7`;
const createdUsers: string[] = [];
let sectionId = '';
const quizIds: string[] = [];

type Role = 'student' | 'admin' | 'sheikh' | 'publisher';
async function account(role: Role, tag: string): Promise<{ c: SupabaseClient; id: string }> {
  const email = `contract-0166-${tag}-${stamp}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `اختبار ${tag}`, gender: 'male' },
  });
  if (error) throw error;
  createdUsers.push(data.user.id);
  if (role !== 'student') {
    const { error: e } = await svc.from('profiles').update({ role }).eq('id', data.user.id);
    if (e) throw e;
  }
  const c = newClient();
  const { error: se } = await c.auth.signInWithPassword({ email, password });
  if (se) throw se;
  return { c, id: data.user.id };
}

/** A published quiz that never announces itself (pre-marked as sent). */
async function seedQuiz(opts2: {
  title: string;
  passScore: number;
  showCorrect: boolean;
  questions: { kind: 'mcq' | 'text'; points: number; model?: string; options?: { text: string; correct: boolean }[] }[];
}) {
  const quizId = crypto.randomUUID();
  const { error: fe } = await svc
    .from('fanout_queue')
    .insert({ kind: 'quiz', ref_id: quizId, params: { sent: true }, done_at: new Date().toISOString() });
  if (fe) throw fe;
  const { error: qe } = await svc.from('quizzes').insert({
    id: quizId,
    section_id: sectionId,
    title: opts2.title,
    pass_score: opts2.passScore,
    show_result: true,
    show_correct_answers: opts2.showCorrect,
    status: 'published',
  });
  if (qe) throw qe;
  quizIds.push(quizId);
  const out: { id: string; kind: string; points: number; options: { id: string; correct: boolean }[] }[] = [];
  for (const [i, q] of opts2.questions.entries()) {
    const { data, error } = await svc
      .from('quiz_questions')
      .insert({ quiz_id: quizId, text: `سؤال ${i + 1}`, points: q.points, order: i, kind: q.kind, model_answer: q.model ?? null })
      .select('id')
      .single();
    if (error) throw error;
    const options: { id: string; correct: boolean }[] = [];
    for (const [j, o] of (q.options ?? []).entries()) {
      const { data: od, error: oe } = await svc
        .from('quiz_options')
        .insert({ question_id: data.id, text: o.text, is_correct: o.correct, order: j })
        .select('id')
        .single();
      if (oe) throw oe;
      options.push({ id: od.id, correct: o.correct });
    }
    out.push({ id: data.id, kind: q.kind, points: q.points, options });
  }
  return { quizId, questions: out };
}

let student: SupabaseClient;
let student2: SupabaseClient;
let studentId = '';
let admin: SupabaseClient;
let sheikh: SupabaseClient;
let publisher: SupabaseClient;

beforeAll(async () => {
  const { data, error } = await svc
    .from('sections')
    .insert({ title: `قسم اختبار 0166 ${stamp}` })
    .select('id')
    .single();
  if (error) throw error;
  sectionId = data.id;
  const s = await account('student', 'stu');
  student = s.c;
  studentId = s.id;
  [student2, admin, sheikh, publisher] = (
    await Promise.all([
      account('student', 'stu2'),
      account('admin', 'adm'),
      account('sheikh', 'shk'),
      account('publisher', 'pub'),
    ])
  ).map((x) => x.c);
}, 60000);

afterAll(async () => {
  await Promise.all([student, student2, admin, sheikh, publisher].filter(Boolean).map((c) => c.auth.signOut()));
  for (const id of quizIds) await svc.from('fanout_queue').delete().eq('ref_id', id);
  if (sectionId) await svc.from('sections').delete().eq('id', sectionId); // quizzes cascade
  for (const id of createdUsers) await svc.auth.admin.deleteUser(id);
}, 60000);

const MCQ = (correctFirst = true) => [
  { text: 'أ', correct: correctFirst },
  { text: 'ب', correct: !correctFirst },
];

describe('MCQ-only quiz — unchanged', () => {
  test('submit grades at once; no grading status; counts as before', async () => {
    const { quizId, questions } = await seedQuiz({
      title: 'اختيار فقط',
      passScore: 2,
      showCorrect: true,
      questions: [
        { kind: 'mcq', points: 2, options: MCQ() },
        { kind: 'mcq', points: 1, options: MCQ() },
      ],
    });
    const { data: attemptId, error } = await student.rpc('start_quiz_attempt', { p_quiz_id: quizId });
    expect(error).toBeNull();
    const correct = questions[0].options.find((o) => o.correct)!.id;
    const wrong = questions[1].options.find((o) => !o.correct)!.id;
    expect((await student.rpc('save_quiz_answer', { p_attempt_id: attemptId, p_question_id: questions[0].id, p_option_id: correct })).error).toBeNull();
    expect((await student.rpc('save_quiz_answer', { p_attempt_id: attemptId, p_question_id: questions[1].id, p_option_id: wrong })).error).toBeNull();
    const { data: r, error: se } = await student.rpc('submit_quiz_attempt', { p_attempt_id: attemptId });
    expect(se).toBeNull();
    expect(r).toMatchObject({
      gradingStatus: null,
      hasWritten: false,
      showResult: true,
      score: 2,
      totalScore: 3,
      passed: true,
      correctCount: 1,
      wrongCount: 1,
    });
    expect(r.details).toHaveLength(2);
    expect(r.details[1]).toMatchObject({ kind: 'mcq', isCorrect: false });
  });
});

describe('mixed quiz — written answers + manual grading', () => {
  let quizId = '';
  let qs: Awaited<ReturnType<typeof seedQuiz>>['questions'];
  let attemptId = '';

  beforeAll(async () => {
    const seeded = await seedQuiz({
      title: 'اختبار مختلط',
      passScore: 6,
      showCorrect: false,
      questions: [
        { kind: 'mcq', points: 2, options: MCQ() },
        { kind: 'text', points: 5, model: 'الإجابة النموذجية' },
        { kind: 'text', points: 3 },
      ],
    });
    quizId = seeded.quizId;
    qs = seeded.questions;
  });

  test('text questions come without options or model answer; text saves and resumes', async () => {
    const { data: id } = await student.rpc('start_quiz_attempt', { p_quiz_id: quizId });
    attemptId = id as string;
    expect(
      (await student.rpc('save_quiz_text_answer', { p_attempt_id: attemptId, p_question_id: qs[1].id, p_text: '  التوحيد هو إفراد الله بالعبادة  ' })).error,
    ).toBeNull();
    const { data } = await student.rpc('get_attempt_questions', { p_attempt_id: attemptId });
    const text = (data as any).questions[1];
    expect(text).toMatchObject({ kind: 'text', textAnswer: 'التوحيد هو إفراد الله بالعبادة', options: [] });
    expect(JSON.stringify(data)).not.toContain('الإجابة النموذجية');
  });

  test('a written answer cannot go to an MCQ question, nor an option to a text one', async () => {
    const r1 = await student.rpc('save_quiz_text_answer', { p_attempt_id: attemptId, p_question_id: qs[0].id, p_text: 'x' });
    expect(r1.error?.message).toContain('إجابة غير صالحة');
    const r2 = await student.rpc('save_quiz_answer', { p_attempt_id: attemptId, p_question_id: qs[1].id, p_option_id: qs[0].options[0].id });
    expect(r2.error?.message).toContain('إجابة غير صالحة');
  });

  test('another student cannot write into this attempt', async () => {
    const r = await student2.rpc('save_quiz_text_answer', { p_attempt_id: attemptId, p_question_id: qs[1].id, p_text: 'x' });
    expect(r.error?.message).toContain('المحاولة غير موجودة');
  });

  test('submit → pending: no score, no pass/fail, no details, no retry', async () => {
    await student.rpc('save_quiz_answer', { p_attempt_id: attemptId, p_question_id: qs[0].id, p_option_id: qs[0].options.find((o) => o.correct)!.id });
    const { data: r, error } = await student.rpc('submit_quiz_attempt', { p_attempt_id: attemptId });
    expect(error).toBeNull();
    expect(r).toMatchObject({
      gradingStatus: 'pending',
      hasWritten: true,
      showResult: false,
      score: null,
      passed: null,
      totalScore: null,
      details: null,
      canRetry: false,
    });
    const intro = (await student.rpc('get_quiz_intro', { p_quiz_id: quizId })).data[0];
    expect(intro).toMatchObject({ pending_review: true, passed: false, best_score: null, attempts_used: 1 });
    const again = await student.rpc('start_quiz_attempt', { p_quiz_id: quizId });
    expect(again.error?.message).toContain('بانتظار التصحيح');
  });

  test('a student cannot see the queue, the attempt detail, or grade', async () => {
    expect((await student.rpc('list_pending_gradings')).error?.message).toContain('غير مصرح');
    expect((await student.rpc('get_attempt_detail', { p_attempt_id: attemptId })).error?.message).toContain('غير مصرح');
    const g = await student.rpc('grade_quiz_attempt', { p_attempt_id: attemptId, p_grades: [] });
    expect(g.error?.message).toContain('غير مصرح');
  });

  test('admin, sheikh and publisher all see it waiting, with the full answer + model answer', async () => {
    for (const grader of [admin, sheikh, publisher]) {
      const { data, error } = await grader.rpc('list_pending_gradings');
      expect(error).toBeNull();
      expect((data as any[]).find((r) => r.attempt_id === attemptId)).toMatchObject({ quiz_title: 'اختبار مختلط', written_count: 2 });
      const { data: d, error: de } = await grader.rpc('get_attempt_detail', { p_attempt_id: attemptId });
      expect(de).toBeNull();
      expect(d).toMatchObject({ gradingStatus: 'pending', mcqScore: 2, totalScore: 10, passScore: 6 });
      expect((d as any).answers[0]).toMatchObject({ kind: 'mcq', awardedPoints: 2, isCorrect: true });
      expect((d as any).answers[1]).toMatchObject({ kind: 'text', textAnswer: 'التوحيد هو إفراد الله بالعبادة', modelAnswer: 'الإجابة النموذجية' });
    }
  });

  test('out-of-range or incomplete grades are refused (nothing is written)', async () => {
    const over = await sheikh.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [{ questionId: qs[1].id, points: 6 }, { questionId: qs[2].id, points: 0 }],
    });
    expect(over.error?.message).toContain('درجة السؤال يجب أن تكون بين');
    const neg = await sheikh.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [{ questionId: qs[1].id, points: -1 }, { questionId: qs[2].id, points: 0 }],
    });
    expect(neg.error).toBeTruthy();
    const frac = await sheikh.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [{ questionId: qs[1].id, points: 2.5 }, { questionId: qs[2].id, points: 0 }],
    });
    expect(frac.error).toBeTruthy();
    const partial = await sheikh.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [{ questionId: qs[1].id, points: 4 }],
    });
    expect(partial.error?.message).toContain('ضع درجة لجميع الأسئلة النصية');
    const foreign = await sheikh.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [{ questionId: qs[0].id, points: 2 }, { questionId: qs[1].id, points: 4 }, { questionId: qs[2].id, points: 0 }],
    });
    expect(foreign.error?.message).toContain('سؤال غير صالح');
    const { data: d } = await admin.rpc('get_attempt_detail', { p_attempt_id: attemptId });
    expect((d as any).gradingStatus).toBe('pending');
    expect((d as any).answers[1].awardedPoints).toBeNull();
  });

  test('publisher approves: score = MCQ + written, pass vs pass_score, grader + time recorded', async () => {
    const { data, error } = await publisher.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [
        { questionId: qs[1].id, points: 4, note: 'إجابة جيدة، لكن ينقصها الدليل' },
        { questionId: qs[2].id, points: 0 }, // left blank by the student
      ],
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ score: 6, totalScore: 10, passScore: 6, passed: true });
    const { data: d } = await admin.rpc('get_attempt_detail', { p_attempt_id: attemptId });
    expect(d).toMatchObject({ gradingStatus: 'graded', score: 6, passed: true, gradedByName: 'اختبار pub' });
    expect((d as any).gradedAt).toBeTruthy();
    const twice = await admin.rpc('grade_quiz_attempt', {
      p_attempt_id: attemptId,
      p_grades: [{ questionId: qs[1].id, points: 5 }, { questionId: qs[2].id, points: 3 }],
    });
    expect(twice.error?.message).toContain('تم اعتماد تصحيح');
  });

  test('the student gets a kept inbox row that opens this attempt', async () => {
    const { data, error } = await student
      .from('notifications')
      .select('type, title, body, data')
      .eq('user_id', studentId)
      .eq('type', 'quiz_graded');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      title: 'تم تصحيح اختبارك ✓',
      body: 'تم تصحيح اختبار «اختبار مختلط»، ويمكنك الآن الاطلاع على نتيجتك.',
      data: { route: `/quiz-result/${attemptId}`, attemptId, quizId },
    });
  });

  test('graded result: score + pass shown, note shown, model answer hidden (show_correct_answers off)', async () => {
    const { data: r, error } = await student.rpc('get_attempt_result', { p_attempt_id: attemptId });
    expect(error).toBeNull();
    expect(r).toMatchObject({ gradingStatus: 'graded', showResult: true, score: 6, totalScore: 10, passScore: 6, passed: true });
    // MCQ rows stay hidden without show_correct_answers; written rows show.
    expect(r.details.map((d: any) => d.kind)).toEqual(['text', 'text']);
    expect(r.details[0]).toMatchObject({
      textAnswer: 'التوحيد هو إفراد الله بالعبادة',
      awardedPoints: 4,
      points: 5,
      graderNote: 'إجابة جيدة، لكن ينقصها الدليل',
      modelAnswer: null,
    });
    expect(JSON.stringify(r)).not.toContain('الإجابة النموذجية');
    const intro = (await student.rpc('get_quiz_intro', { p_quiz_id: quizId })).data[0];
    expect(intro).toMatchObject({ pending_review: false, passed: true, best_score: 6 });
  });

  test('admin results: the pending/passed buckets', async () => {
    const { data: rows } = await sheikh.rpc('list_quiz_result_rows', { p_quiz_id: quizId });
    expect((rows as any[])[0].status).toBe('passed');
    const { data: sum } = await publisher.rpc('get_quiz_results_summary', { p_quiz_id: quizId });
    expect((sum as any[])[0]).toMatchObject({ passed_count: 1, pending_count: 0 });
  });
});

describe('question editor (RLS)', () => {
  test('a publisher can author a draft quiz with MCQ + written questions; a student reads none', async () => {
    const { data: quiz, error } = await publisher
      .from('quizzes')
      .insert({ section_id: sectionId, title: 'مسودة ناشر', pass_score: 1, status: 'draft' })
      .select('id')
      .single();
    expect(error).toBeNull();
    quizIds.push(quiz!.id);
    const { data: q, error: qe } = await publisher
      .from('quiz_questions')
      .insert({ quiz_id: quiz!.id, text: 'اشرح', points: 3, order: 0, kind: 'text', model_answer: 'نموذج' })
      .select('id, kind, model_answer')
      .single();
    expect(qe).toBeNull();
    expect(q).toMatchObject({ kind: 'text', model_answer: 'نموذج' });
    const { data: m, error: me } = await publisher
      .from('quiz_questions')
      .insert({ quiz_id: quiz!.id, text: 'اختر', points: 1, order: 1 })
      .select('id, kind')
      .single();
    expect(me).toBeNull();
    expect(m!.kind).toBe('mcq'); // the default — every pre-0166 question
    expect((await publisher.from('quiz_options').insert({ question_id: m!.id, text: 'أ', is_correct: true, order: 0 })).error).toBeNull();
    const bad = await publisher.from('quiz_questions').insert({ quiz_id: quiz!.id, text: 'x', points: 1, kind: 'essay' });
    expect(bad.error).toBeTruthy();
    const { data: peek } = await student.from('quiz_questions').select('id, model_answer');
    expect(peek).toEqual([]);
  });
});

describe('model answer respects «إظهار الإجابات الصحيحة»', () => {
  test('shown after grading when on; a failing total reads لم يجتز', async () => {
    const { quizId, questions } = await seedQuiz({
      title: 'نصي مع نموذج',
      passScore: 4,
      showCorrect: true,
      questions: [{ kind: 'text', points: 5, model: 'نموذج ظاهر' }],
    });
    const { data: attemptId } = await student2.rpc('start_quiz_attempt', { p_quiz_id: quizId });
    await student2.rpc('save_quiz_text_answer', { p_attempt_id: attemptId, p_question_id: questions[0].id, p_text: 'إجابة قصيرة' });
    const pending = (await student2.rpc('submit_quiz_attempt', { p_attempt_id: attemptId })).data;
    expect(JSON.stringify(pending)).not.toContain('نموذج ظاهر');
    const { data: list } = await admin.rpc('list_quiz_result_rows', { p_quiz_id: quizId });
    expect((list as any[])[0].status).toBe('pending');
    const { data: sum } = await admin.rpc('get_quiz_results_summary', { p_quiz_id: quizId });
    expect((sum as any[])[0]).toMatchObject({ pending_count: 1, failed_count: 0 });

    expect((await sheikh.rpc('grade_quiz_attempt', { p_attempt_id: attemptId, p_grades: [{ questionId: questions[0].id, points: 2 }] })).error).toBeNull();
    const { data: r } = await student2.rpc('get_attempt_result', { p_attempt_id: attemptId });
    expect(r).toMatchObject({ score: 2, passed: false, canRetry: true });
    expect(r.details[0]).toMatchObject({ modelAnswer: 'نموذج ظاهر', awardedPoints: 2, graderNote: null });
  });
});
