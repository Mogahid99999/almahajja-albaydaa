/**
 * Quiz save — batched writes + «نشر بدون إشعار» (2026-11-17, 0181).
 *
 * Saving a 20-question quiz from the admin web took ~55 s: one request per
 * question and per option (~100 requests). The save is now a fixed handful of
 * requests whatever the quiz size, and the publish confirmation's choice
 * reaches quizzes.notify_on_publish only when it was made.
 */
type Call = { table: string; op: string; arg?: unknown };

const mockCalls: Call[] = [];
let mockExisting: { id: string; quiz_options: { id: string }[] }[] = [];

function mockBuilder(table: string) {
  const b: Record<string, unknown> = {};
  let op = 'select';
  let arg: unknown;
  const result = () => {
    mockCalls.push({ table, op, arg });
    if (table === 'quiz_questions' && op === 'select') return { data: mockExisting, error: null };
    if (table === 'quiz_questions' && op === 'insert') {
      const rows = arg as { order: number }[];
      // Returned in reverse on purpose: ids must be matched by `order`.
      return { data: [...rows].reverse().map((r) => ({ id: `new-${r.order}`, order: r.order })), error: null };
    }
    return { data: null, error: null };
  };
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete']) {
    b[m] = (a?: unknown) => {
      if (m === 'select' && op !== 'select') return b; // .insert(...).select(...)
      op = m;
      arg = a;
      return b;
    };
  }
  b.eq = () => b;
  b.in = () => b;
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(res, rej);
  return b;
}

jest.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => mockBuilder(t) } }));

import { setQuizStatus, updateQuiz } from '../quizzes';
import type { QuizInput, QuizQuestionInput } from '../types';

const input: QuizInput = {
  sectionId: 's1',
  title: 'اختبار العقيدة الواسطية',
  description: null,
  passScore: 50,
  timeLimitSec: 1800,
  maxAttempts: null,
  showResult: true,
  showCorrectAnswers: false,
  status: 'published',
  order: 0,
  availabilityMode: 'open',
  availableFrom: null,
  availableUntil: null,
};

function quiz(n: number): QuizQuestionInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    text: `سؤال ${i}`,
    points: 5,
    order: i,
    kind: 'mcq' as const,
    modelAnswer: null,
    options: [0, 1, 2].map((j) => ({ id: `q${i}o${j}`, text: `خيار ${j}`, isCorrect: j === 0, order: j })),
  }));
}

beforeEach(() => {
  mockCalls.length = 0;
});

test('a 20-question quiz saves in a fixed handful of requests, not one per row', async () => {
  const questions = quiz(20);
  mockExisting = questions.map((q) => ({ id: q.id!, quiz_options: q.options.map((o) => ({ id: o.id! })) }));
  await updateQuiz('quiz1', input, questions);
  // quiz update + read + questions upsert + options upsert
  expect(mockCalls.map((c) => `${c.table}:${c.op}`)).toEqual([
    'quizzes:update',
    'quiz_questions:select',
    'quiz_questions:upsert',
    'quiz_options:upsert',
  ]);
  expect((mockCalls[2].arg as unknown[]).length).toBe(20);
  expect((mockCalls[3].arg as unknown[]).length).toBe(60);
});

test('removed rows are deleted and new rows inserted, options linked to the right new question', async () => {
  const questions = quiz(3);
  // q2 and option q0o2 were removed in the editor; one new question added.
  mockExisting = [
    ...questions.map((q) => ({ id: q.id!, quiz_options: q.options.map((o) => ({ id: o.id! })) })),
    { id: 'gone', quiz_options: [{ id: 'gone-o' }] },
  ];
  questions[0].options = questions[0].options.slice(0, 2);
  questions.push({
    text: 'سؤال جديد',
    points: 5,
    order: 3,
    kind: 'mcq',
    modelAnswer: null,
    options: [
      { text: 'أ', isCorrect: true, order: 0 },
      { text: 'ب', isCorrect: false, order: 1 },
    ],
  });
  questions.push({ text: 'سؤال جديد ٢', points: 5, order: 4, kind: 'text', modelAnswer: null, options: [] });

  await updateQuiz('quiz1', input, questions);
  const ops = mockCalls.map((c) => `${c.table}:${c.op}`);
  expect(ops).toEqual([
    'quizzes:update',
    'quiz_questions:select',
    'quiz_questions:delete',
    'quiz_options:delete',
    'quiz_questions:upsert',
    'quiz_questions:insert',
    'quiz_options:upsert',
    'quiz_options:insert',
  ]);
  const newOptions = mockCalls[7].arg as { question_id: string }[];
  expect(newOptions.map((o) => o.question_id)).toEqual(['new-3', 'new-3']);
});

test('«نشر بدون إشعار» writes notify_on_publish=false; a plain save leaves the column alone', async () => {
  mockExisting = [];
  await updateQuiz('quiz1', { ...input, notifyOnPublish: false }, []);
  expect(mockCalls[0].arg).toMatchObject({ status: 'published', notify_on_publish: false });

  mockCalls.length = 0;
  await updateQuiz('quiz1', input, []);
  expect(mockCalls[0].arg).not.toHaveProperty('notify_on_publish');

  mockCalls.length = 0;
  await setQuizStatus('quiz1', 'published', true);
  expect(mockCalls[0].arg).toEqual({ status: 'published', notify_on_publish: true });

  mockCalls.length = 0;
  await setQuizStatus('quiz1', 'draft');
  expect(mockCalls[0].arg).toEqual({ status: 'draft' });
});
