/**
 * Contract tests for the batched quiz save + 0181 «نشر بدون إشعار» against
 * STAGING. The real src/api/quizzes.ts functions run with a real publisher
 * session (anon key, RLS under test); the service key only creates/deletes the
 * throwaway account and section, and reads fanout_queue.
 *
 * Invariants:
 *  - a 20-question quiz is created and re-saved with bulk upsert/insert under
 *    RLS, quickly, and the stored questions/options equal what the editor sent
 *    (removed rows gone, new ones linked to the right question, order kept);
 *  - publish with «نشر بدون إشعار» enqueues no notification job;
 *  - publish with «نشر وإرسال إشعار» enqueues one;
 *  - unpublish writes only the status.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { QuizInput, QuizQuestionInput } from '@/api/types';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);

const mockHolder: { client: SupabaseClient | null } = { client: null };
jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockHolder.client;
  },
}));

// quizzes.ts reaches the theme tokens (Platform) through quizAvailability.
jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default },
}));

// eslint-disable-next-line import/first
import { createQuiz, setQuizStatus, updateQuiz } from '@/api/quizzes';

const stamp = Date.now();
const password = `Contract-${stamp}-q8`;
let userId = '';
let sectionId = '';
const quizIds: string[] = [];

beforeAll(async () => {
  const email = `contract-0181-${stamp}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'اختبار 0181', gender: 'male' },
  });
  if (error) throw error;
  userId = data.user.id;
  const { error: re } = await svc.from('profiles').update({ role: 'publisher' }).eq('id', userId);
  if (re) throw re;
  const c = createClient(url, anonKey, opts);
  const { error: se } = await c.auth.signInWithPassword({ email, password });
  if (se) throw se;
  mockHolder.client = c;

  const { data: s, error: sErr } = await svc
    .from('sections')
    .insert({ title: `zz contract 0181 ${stamp}` })
    .select('id')
    .single();
  if (sErr) throw sErr;
  sectionId = s!.id;
});

afterAll(async () => {
  if (quizIds.length) {
    await svc.from('fanout_queue').delete().eq('kind', 'quiz').in('ref_id', quizIds);
    await svc.from('quizzes').delete().in('id', quizIds);
  }
  if (sectionId) await svc.from('sections').delete().eq('id', sectionId);
  if (userId) await svc.auth.admin.deleteUser(userId);
});

const baseInput = (over: Partial<QuizInput> = {}): QuizInput => ({
  sectionId,
  title: 'اختبار العقيدة — عقد',
  description: null,
  passScore: 50,
  timeLimitSec: 1800,
  maxAttempts: null,
  showResult: true,
  showCorrectAnswers: false,
  status: 'draft',
  order: 0,
  availabilityMode: 'open',
  availableFrom: null,
  availableUntil: null,
  ...over,
});

function newQuestions(n: number): QuizQuestionInput[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `سؤال ${i + 1}`,
    points: 5,
    order: i,
    kind: 'mcq' as const,
    modelAnswer: null,
    options: [0, 1, 2].map((j) => ({ text: `خيار ${i + 1}-${j + 1}`, isCorrect: j === 0, order: j })),
  }));
}

async function stored(quizId: string) {
  const { data, error } = await svc
    .from('quiz_questions')
    .select('id, text, order, kind, quiz_options(id, text, is_correct, order)')
    .eq('quiz_id', quizId)
    .order('order');
  if (error) throw error;
  return (data ?? []).map((q) => ({
    ...q,
    quiz_options: [...(q.quiz_options as { id: string; text: string; is_correct: boolean; order: number }[])].sort(
      (a, b) => a.order - b.order,
    ),
  }));
}

async function jobs(quizId: string) {
  const { data, error } = await svc.from('fanout_queue').select('id, done_at').eq('kind', 'quiz').eq('ref_id', quizId);
  if (error) throw error;
  return data ?? [];
}

test('a 20-question quiz is created and re-saved in bulk, and the stored rows match', async () => {
  const t0 = Date.now();
  const quizId = await createQuiz(baseInput(), newQuestions(20));
  quizIds.push(quizId);
  let rows = await stored(quizId);
  expect(rows).toHaveLength(20);
  expect(rows.every((q) => q.quiz_options.length === 3)).toBe(true);

  // Edit like the editor does: keep ids, drop question 20 and one option of
  // question 1, rename question 2, add a written and an MCQ question.
  const edited: QuizQuestionInput[] = rows.slice(0, 19).map((q, i) => ({
    id: q.id,
    text: i === 1 ? 'سؤال ٢ بعد التعديل' : q.text,
    points: 5,
    order: i,
    kind: 'mcq',
    modelAnswer: null,
    options: q.quiz_options
      .filter((o, j) => !(i === 0 && j === 2))
      .map((o, j) => ({ id: o.id, text: o.text, isCorrect: o.is_correct, order: j })),
  }));
  edited.push({ text: 'سؤال نصي جديد', points: 5, order: 19, kind: 'text', modelAnswer: 'نموذج', options: [] });
  edited.push({
    text: 'سؤال اختيار جديد',
    points: 5,
    order: 20,
    kind: 'mcq',
    modelAnswer: null,
    options: [
      { text: 'أ', isCorrect: false, order: 0 },
      { text: 'ب', isCorrect: true, order: 1 },
    ],
  });
  await updateQuiz(quizId, baseInput(), edited);
  const elapsed = Date.now() - t0;

  rows = await stored(quizId);
  expect(rows.map((q) => q.text)).toEqual(edited.map((q) => q.text));
  expect(rows[0].quiz_options).toHaveLength(2);
  expect(rows[19].kind).toBe('text');
  expect(rows[19].quiz_options).toHaveLength(0);
  expect(rows[20].quiz_options.map((o) => [o.text, o.is_correct])).toEqual([
    ['أ', false],
    ['ب', true],
  ]);
  // Two full saves of a 20-question quiz used to take ~100 s; now a few seconds.
  expect(elapsed).toBeLessThan(15000);
});

test('«نشر بدون إشعار» publishes without a notification job; «نشر وإرسال إشعار» queues one', async () => {
  const silent = await createQuiz(baseInput({ title: 'zz silent' }), newQuestions(1));
  quizIds.push(silent);
  await setQuizStatus(silent, 'published', false);
  expect(await jobs(silent)).toHaveLength(0);

  const loud = await createQuiz(baseInput({ title: 'zz loud' }), newQuestions(1));
  quizIds.push(loud);
  await setQuizStatus(loud, 'published', true);
  expect(await jobs(loud)).toHaveLength(1);

  // The editor path: publish-on-save with the silent choice.
  const edited = await createQuiz(baseInput({ title: 'zz editor' }), newQuestions(1));
  quizIds.push(edited);
  await updateQuiz(edited, baseInput({ title: 'zz editor', status: 'published', notifyOnPublish: false }), []);
  expect(await jobs(edited)).toHaveLength(0);

  // Unpublish touches only the status; the silent choice stays.
  await setQuizStatus(silent, 'draft');
  const { data } = await svc.from('quizzes').select('status, notify_on_publish').eq('id', silent).single();
  expect(data).toEqual({ status: 'draft', notify_on_publish: false });
});
