/**
 * أسئلة «إجابة نصية» + التصحيح اليدوي (migration 0166) — the screens.
 *
 * Invariants:
 *  - result: «بانتظار التصحيح» shows the submitted-successfully copy and NO score,
 *    pass/fail or review; a graded mixed quiz shows «درجتك N من M» + the pass line
 *    but no right/wrong counts; a written review card shows the answer, «الدرجة:
 *    ٤ / ٥», the grader's note and (only when sent) the model answer; an MCQ-only
 *    result is unchanged (counts + ✓/✕ review);
 *  - grading: approve stays disabled until every written question has a whole
 *    score within 0..max; out-of-range is flagged; approval sends all scores +
 *    notes; a graded attempt is read-only;
 *  - the queue lists pending attempts with a count and opens one; the quizzes
 *    list links to it with the count;
 *  - the editor offers نوع السؤال; a written question has no options and an
 *    optional model answer, and saves as kind 'text' with options [].
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { AdminAttemptDetail, QuizResult } from '@/api/types';

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/admin/TreePicker', () => ({
  TreePicker: () => null,
}));
jest.mock('@/components/section/SectionNavBar', () => ({ SectionNavBar: () => null }));
jest.mock('@/hooks/useAuth', () => ({ useCurrentUser: () => ({ data: { isGuest: false } }) }));

let mockResult: QuizResult | undefined;
let mockDetail: AdminAttemptDetail | undefined;
let mockPending: unknown[] = [];
const mockGrade = { mutate: jest.fn(), isPending: false };
const mockCreate = { mutate: jest.fn(), isPending: false };
const mockUpdate = { mutate: jest.fn(), isPending: false };
let mockAdminQuiz: unknown;
let mockIntro: unknown;
const mockStart = { mutate: jest.fn(), isPending: false };
let mockIntegrity: { version: number; body: string } | null = null;

jest.mock('@/hooks/useQuizzes', () => ({
  useAttemptResult: () => ({ data: mockResult, isLoading: false, isError: false }),
  useAdminAttemptDetail: () => ({ data: mockDetail, isLoading: false }),
  useGradeAttempt: () => mockGrade,
  usePendingGradings: () => ({ data: mockPending, isLoading: false, isError: false, refetch: jest.fn() }),
  useAdminQuizzes: () => ({ data: [], isLoading: false }),
  useDeleteQuiz: () => ({ mutate: jest.fn(), isPending: false }),
  useSetQuizStatus: () => ({ mutate: jest.fn(), isPending: false }),
  useSetQuizAvailability: () => ({ mutate: jest.fn(), isPending: false }),
  useAdminQuiz: () => ({ data: mockAdminQuiz }),
  useQuizIntro: () => ({ data: mockIntro, isLoading: false, isError: false }),
  useStartAttempt: () => mockStart,
  useLocalQuizAttempt: () => ({ data: null }),
  useQuizIntegrity: () => ({ data: mockIntegrity, isLoading: false }),
  useCreateQuiz: () => mockCreate,
  useUpdateQuiz: () => mockUpdate,
}));

import AdminQuizAttemptScreen from '../../app/admin/quiz-attempt';
import QuizEditScreen from '../../app/admin/quiz-edit';
import QuizGradingQueueScreen from '../../app/admin/quiz-grading';
import AdminQuizzesScreen from '../../app/admin/quizzes';
import QuizResultScreen from '../../app/(student)/quiz-result/[attemptId]';
import QuizIntroScreen from '../../app/(student)/quiz/[id]';
import { parseGrade } from '@/components/quiz/grading';

const baseResult = (over: Partial<QuizResult> = {}): QuizResult => ({
  attemptId: 'a1',
  quizId: 'z1',
  quizTitle: 'اختبار التوحيد',
  submittedAt: '2026-11-08T10:00:00Z',
  showResult: true,
  showCorrectAnswers: false,
  attemptsLeft: null,
  canRetry: false,
  questionCount: 2,
  score: 18,
  passed: true,
  totalScore: 20,
  passScore: 12,
  correctCount: 1,
  wrongCount: 0,
  details: null,
  gradingStatus: null,
  hasWritten: false,
  ...over,
});

beforeEach(() => {
  mockParams = { attemptId: 'a1', id: 'a1' };
  mockGrade.mutate.mockReset();
  mockGrade.isPending = false;
  mockCreate.mutate.mockReset();
  mockUpdate.mutate.mockReset();
  mockRouter.push.mockReset();
  mockPending = [];
  mockAdminQuiz = undefined;
});

describe('student result', () => {
  test('pending: submitted-successfully copy, no score / pass / review', async () => {
    mockResult = baseResult({
      gradingStatus: 'pending',
      hasWritten: true,
      showResult: false,
      score: null,
      passed: null,
      totalScore: null,
      passScore: null,
    });
    await render(<QuizResultScreen />);
    expect(screen.getByText('تم تسليم الاختبار بنجاح')).toBeTruthy();
    expect(
      screen.getByText('إجاباتك النصية بانتظار التصحيح، وستظهر نتيجتك بعد اكتمال التصحيح بإذن الله.'),
    ).toBeTruthy();
    expect(screen.getByText('بانتظار التصحيح')).toBeTruthy();
    expect(screen.queryByText('درجتك')).toBeNull();
    expect(screen.queryByText('اجتزت الاختبار')).toBeNull();
    expect(screen.queryByText('لم تجتز الاختبار')).toBeNull();
    expect(screen.queryByText('مراجعة الإجابات')).toBeNull();
  });

  test('graded mixed quiz: score + pass line, no right/wrong counts; written review card', async () => {
    mockResult = baseResult({
      gradingStatus: 'graded',
      hasWritten: true,
      details: [
        {
          questionId: 'q2',
          text: 'اشرح معنى التوحيد',
          points: 5,
          kind: 'text',
          selectedOptionId: null,
          selectedOptionText: 'إفراد الله بالعبادة',
          correctOptionId: null,
          correctOptionText: null,
          isCorrect: false,
          textAnswer: 'إفراد الله بالعبادة',
          awardedPoints: 4,
          graderNote: 'إجابة جيدة، لكن ينقصها الدليل',
          modelAnswer: null,
        },
      ],
    });
    await render(<QuizResultScreen />);
    expect(screen.getByText('درجتك')).toBeTruthy();
    expect(screen.getByText('١٨ من ٢٠')).toBeTruthy();
    expect(screen.getByText('درجة النجاح: ١٢')).toBeTruthy();
    expect(screen.getByText('اجتزت الاختبار')).toBeTruthy();
    expect(screen.queryByText('إجابات صحيحة')).toBeNull();
    expect(screen.queryByText('إجابات خاطئة')).toBeNull();
    expect(screen.getByText('مراجعة الإجابات')).toBeTruthy();
    expect(screen.getByText('إجابتك')).toBeTruthy();
    expect(screen.getByText('إفراد الله بالعبادة')).toBeTruthy();
    expect(screen.getByText('الدرجة: ٤ / ٥')).toBeTruthy();
    expect(screen.getByText('ملاحظة المصحح')).toBeTruthy();
    expect(screen.getByText('إجابة جيدة، لكن ينقصها الدليل')).toBeTruthy();
    expect(screen.queryByText('الإجابة النموذجية')).toBeNull(); // not sent (setting off)
  });

  test('the model answer shows when the server sends it («إظهار الإجابات الصحيحة» on)', async () => {
    mockResult = baseResult({
      gradingStatus: 'graded',
      hasWritten: true,
      showCorrectAnswers: true,
      details: [
        {
          questionId: 'q2',
          text: 'اشرح',
          points: 5,
          kind: 'text',
          selectedOptionId: null,
          selectedOptionText: null,
          correctOptionId: null,
          correctOptionText: 'النموذج',
          isCorrect: false,
          textAnswer: null,
          awardedPoints: 0,
          graderNote: null,
          modelAnswer: 'النموذج',
        },
      ],
    });
    await render(<QuizResultScreen />);
    expect(screen.getByText('الإجابة النموذجية')).toBeTruthy();
    expect(screen.getByText('النموذج')).toBeTruthy();
    expect(screen.getByText('لم تكتب إجابة لهذا السؤال')).toBeTruthy();
  });

  test('an MCQ-only result is unchanged: counts + ✓/✕ review', async () => {
    mockResult = baseResult({
      score: 2,
      totalScore: 3,
      passScore: 2,
      correctCount: 1,
      wrongCount: 1,
      showCorrectAnswers: true,
      details: [
        {
          questionId: 'q1',
          text: 'سؤال',
          points: 1,
          kind: 'mcq',
          selectedOptionId: 'o2',
          selectedOptionText: 'ب',
          correctOptionId: 'o1',
          correctOptionText: 'أ',
          isCorrect: false,
        },
      ],
    });
    await render(<QuizResultScreen />);
    expect(screen.getByText('٢ من ٣')).toBeTruthy();
    expect(screen.getByText('إجابات صحيحة')).toBeTruthy();
    expect(screen.getByText('إجابات خاطئة')).toBeTruthy();
    expect(screen.getByText('إجابتك: ب')).toBeTruthy();
    expect(screen.getByText('الإجابة الصحيحة: أ')).toBeTruthy();
  });
});

const pendingDetail = (): AdminAttemptDetail => ({
  attemptId: 'a1',
  quizId: 'z1',
  quizTitle: 'اختبار مختلط',
  displayName: 'عبد الله',
  attemptNo: 1,
  startedAt: '2026-11-08T09:50:00Z',
  submittedAt: '2026-11-08T10:00:00Z',
  durationSec: 600,
  score: null,
  passed: null,
  totalScore: 10,
  passScore: 6,
  mcqScore: 2,
  gradingStatus: 'pending',
  gradedAt: null,
  gradedByName: null,
  answers: [
    {
      questionId: 'q1',
      text: 'اختر',
      points: 2,
      kind: 'mcq',
      selectedOptionText: 'أ',
      correctOptionText: 'أ',
      isCorrect: true,
      awardedPoints: 2,
    },
    {
      questionId: 'q2',
      text: 'اشرح معنى التوحيد',
      points: 5,
      kind: 'text',
      selectedOptionText: null,
      correctOptionText: null,
      isCorrect: false,
      textAnswer: 'إفراد الله بالعبادة',
      modelAnswer: 'إفراد الله وحده بالعبادة مع الدليل',
      awardedPoints: null,
      graderNote: null,
    },
    {
      questionId: 'q3',
      text: 'اذكر الدليل',
      points: 3,
      kind: 'text',
      selectedOptionText: null,
      correctOptionText: null,
      isCorrect: false,
      textAnswer: null,
      modelAnswer: null,
      awardedPoints: null,
      graderNote: null,
    },
  ],
  otherAttempts: [],
});

describe('quiz intro while an attempt awaits grading', () => {
  test('pill + disabled «بانتظار التصحيح» instead of a retry; the last result stays reachable', async () => {
    mockIntro = {
      id: 'z1',
      title: 'اختبار مختلط',
      description: null,
      questionCount: 3,
      totalScore: 10,
      passScore: 6,
      timeLimitSec: null,
      maxAttempts: null,
      attemptsUsed: 1,
      attemptsLeft: null,
      bestScore: null,
      status: 'pending_review',
      inProgressAttemptId: null,
      lastResultAttemptId: 'a1',
      order: 0,
      availability: 'open',
      availableFrom: null,
      availableUntil: null,
      sectionId: 's1',
      sectionTitle: 'التوحيد',
    };
    await render(<QuizIntroScreen />);
    expect(screen.getAllByText('بانتظار التصحيح')).toHaveLength(2); // pill + button
    expect(screen.queryByText('إعادة المحاولة')).toBeNull();
    for (const el of screen.getAllByText('بانتظار التصحيح')) await fireEvent.press(el);
    expect(mockStart.mutate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('عرض آخر نتيجة'));
    expect(mockRouter.push).toHaveBeenCalledWith('/quiz-result/a1');
  });
});

describe('admin grading', () => {
  test('MCQ read-only with the system score; written shows answer + model answer + grade field', async () => {
    mockDetail = pendingDetail();
    await render(<AdminQuizAttemptScreen />);
    expect(screen.getAllByText('بانتظار التصحيح').length).toBeGreaterThan(0);
    expect(screen.getByText('الدرجة (تلقائيًا): ٢ / ٢')).toBeTruthy();
    expect(screen.getByText('إفراد الله بالعبادة')).toBeTruthy();
    expect(screen.getByText('الإجابة النموذجية')).toBeTruthy();
    expect(screen.getByText('لم يكتب الطالب إجابة لهذا السؤال.')).toBeTruthy();
    expect(screen.getAllByText('درجة الطالب:')).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('ملاحظة للطالب — اختياري')).toHaveLength(2);
  });

  test('approve is disabled until every written score is valid; over-max is flagged', async () => {
    mockDetail = pendingDetail();
    await render(<AdminQuizAttemptScreen />);
    // The blank written answer starts at 0; the answered one is empty → not ready.
    expect(screen.getByText('ضع درجة لجميع الأسئلة النصية قبل الاعتماد.')).toBeTruthy();
    const approve = screen.getByText('اعتماد التصحيح وإرسال النتيجة');
    await fireEvent.press(approve);
    expect(screen.queryByText('اعتماد التصحيح؟')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('درجة السؤال 2'), '6');
    expect(screen.getByText('الدرجة من ٠ إلى ٥')).toBeTruthy();
    expect(screen.getByText('ضع درجة لجميع الأسئلة النصية قبل الاعتماد.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('درجة السؤال 2'), '٤'); // Arabic digit
    expect(screen.queryByText('الدرجة من ٠ إلى ٥')).toBeNull();
    expect(screen.getByText('٦ من ١٠')).toBeTruthy(); // 2 (MCQ) + 4 + 0
    expect(screen.getByText('النتيجة: اجتاز')).toBeTruthy();
  });

  test('approval sends every written score with its note', async () => {
    mockDetail = pendingDetail();
    mockGrade.mutate.mockImplementation((_v, cbs) => {
      cbs.onSuccess();
      cbs.onSettled();
    });
    await render(<AdminQuizAttemptScreen />);
    await fireEvent.changeText(screen.getByLabelText('درجة السؤال 2'), '4');
    await fireEvent.changeText(
      screen.getAllByPlaceholderText('ملاحظة للطالب — اختياري')[0],
      '  إجابة جيدة، لكن ينقصها الدليل ',
    );
    await fireEvent.press(screen.getByText('اعتماد التصحيح وإرسال النتيجة'));
    expect(screen.getByText('اعتماد التصحيح؟')).toBeTruthy();
    await fireEvent.press(screen.getByText('اعتماد وإرسال'));
    expect(mockGrade.mutate).toHaveBeenCalledWith(
      {
        attemptId: 'a1',
        grades: [
          { questionId: 'q2', points: 4, note: 'إجابة جيدة، لكن ينقصها الدليل' },
          { questionId: 'q3', points: 0, note: null },
        ],
      },
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText('تم اعتماد التصحيح وإرسال النتيجة إلى الطالب.')).toBeTruthy());
  });

  test('a graded attempt is read-only with its grade, note and grader', async () => {
    const d = pendingDetail();
    mockDetail = {
      ...d,
      gradingStatus: 'graded',
      score: 6,
      passed: true,
      gradedByName: 'الشيخ',
      gradedAt: '2026-11-08T11:00:00Z',
      answers: d.answers.map((a) =>
        a.questionId === 'q2' ? { ...a, awardedPoints: 4, graderNote: 'أحسنت' } : a.kind === 'text' ? { ...a, awardedPoints: 0 } : a,
      ),
    };
    await render(<AdminQuizAttemptScreen />);
    expect(screen.queryByText('درجة الطالب:')).toBeNull();
    expect(screen.queryByText('اعتماد التصحيح وإرسال النتيجة')).toBeNull();
    expect(screen.getByText('اجتاز')).toBeTruthy();
    expect(screen.getByText('الدرجة: ٤ / ٥')).toBeTruthy();
    expect(screen.getByText('أحسنت')).toBeTruthy();
    expect(screen.getByText(/الشيخ ·/)).toBeTruthy();
  });

  test('parseGrade: whole numbers within 0..max only', () => {
    expect(parseGrade('0', 5)).toBe(0);
    expect(parseGrade('5', 5)).toBe(5);
    expect(parseGrade('٣', 5)).toBe(3);
    expect(parseGrade('6', 5)).toBeNull();
    expect(parseGrade('-1', 5)).toBeNull();
    expect(parseGrade('2.5', 5)).toBeNull();
    expect(parseGrade('', 5)).toBeNull();
  });
});

describe('«بانتظار التصحيح» queue', () => {
  test('lists pending attempts with the count and opens one', async () => {
    mockPending = [
      {
        attemptId: 'a9',
        quizId: 'z1',
        quizTitle: 'اختبار مختلط',
        sectionTitle: 'التوحيد',
        displayName: 'عبد الله',
        attemptNo: 1,
        submittedAt: '2026-11-08T10:00:00Z',
        writtenCount: 2,
      },
    ];
    await render(<QuizGradingQueueScreen />);
    expect(screen.getByText('بانتظار التصحيح (١)')).toBeTruthy();
    expect(screen.getByText('عبد الله')).toBeTruthy();
    expect(screen.getByText('اختبار مختلط · التوحيد · المحاولة ١')).toBeTruthy();
    await fireEvent.press(screen.getByText('عبد الله'));
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/quiz-attempt?id=a9');
  });

  test('empty queue reads calmly; the quizzes list links to it with the count', async () => {
    await render(<QuizGradingQueueScreen />);
    expect(screen.getByText('لا توجد محاولات بانتظار التصحيح')).toBeTruthy();

    mockPending = [{}, {}, {}];
    await render(<AdminQuizzesScreen />);
    await fireEvent.press(screen.getByText('بانتظار التصحيح (٣)'));
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/quiz-grading');
  });
});

describe('editor — نوع السؤال', () => {
  test('a written question hides the options, offers a model answer, saves kind text with no options', async () => {
    mockParams = { id: 'z1' };
    mockAdminQuiz = {
      id: 'z1',
      sectionId: 's1',
      title: 'اختبار',
      description: null,
      passScore: 1,
      timeLimitSec: null,
      maxAttempts: null,
      showResult: true,
      showCorrectAnswers: false,
      status: 'draft',
      order: 0,
      availabilityMode: 'open',
      availableFrom: null,
      availableUntil: null,
      questions: [
        {
          id: 'q1',
          text: 'سؤال قديم',
          points: 2,
          order: 0,
          kind: 'mcq',
          modelAnswer: null,
          options: [
            { id: 'o1', text: 'أ', isCorrect: true, order: 0 },
            { id: 'o2', text: 'ب', isCorrect: false, order: 1 },
          ],
        },
      ],
    };
    await render(<QuizEditScreen />);
    expect(screen.getByDisplayValue('أ')).toBeTruthy();
    await fireEvent.press(screen.getByText('إجابة نصية'));
    expect(screen.queryByDisplayValue('أ')).toBeNull();
    expect(screen.queryByText('إضافة خيار')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('مرجع للمصحح...'), 'النموذج');
    await fireEvent.press(screen.getAllByText(/حفظ/).at(-1)!);
    expect(mockUpdate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        quizId: 'z1',
        questions: [
          expect.objectContaining({ id: 'q1', kind: 'text', modelAnswer: 'النموذج', options: [] }),
        ],
      }),
      expect.anything(),
    );
  });
});

describe('integrity statement (0175)', () => {
  const intro = { id: 'z', title: 'اختبار', description: null, status: 'not_started', attemptsUsed: 0, availability: 'open', questionCount: 1, totalScore: 1, passScore: 1, timeLimitSec: null, maxAttempts: null, attemptsLeft: null, lastResultAttemptId: null, sectionTitle: 'قسم' };

  beforeEach(() => {
    mockParams = { id: 'z' };
    mockIntro = intro;
    mockStart.mutate.mockClear();
  });
  afterEach(() => {
    mockIntegrity = null;
  });

  test('a quiz not required for a certificate shows no statement and starts at once', async () => {
    await render(<QuizIntroScreen />);
    expect(screen.queryByText('إقرار النزاهة')).toBeNull();
    fireEvent.press(screen.getByText('ابدأ الاختبار'));
    expect(mockStart.mutate).toHaveBeenCalledWith({ quizId: 'z', integrityVersion: undefined }, expect.anything());
  });

  test('a required quiz cannot start until the box is ticked, then sends the version', async () => {
    mockIntegrity = { version: 1, body: 'أُقرّ بأنني سأؤدي هذا الاختبار بنفسي' };
    await render(<QuizIntroScreen />);
    expect(screen.getByText('إقرار النزاهة')).toBeTruthy();
    expect(screen.getByText('أُقرّ بأنني سأؤدي هذا الاختبار بنفسي')).toBeTruthy();
    fireEvent.press(screen.getByText('بدء الاختبار'));
    expect(mockStart.mutate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('أوافق على الإقرار وأتعهد بالالتزام به.'));
    await fireEvent.press(screen.getByText('بدء الاختبار'));
    expect(mockStart.mutate).toHaveBeenCalledWith({ quizId: 'z', integrityVersion: 1 }, expect.anything());
  });
});
