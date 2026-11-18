/**
 * Admin «hide from every student» actions confirm first (2026-11-18).
 *
 * Quizzes were turned into drafts by accident with one tap on the list icon
 * (2026-11-15 / 11-17, see 0181). Every list action that hides content from all
 * students now asks before doing it: unpublishing a quiz or a lecture, closing
 * a quiz. Showing / opening again stays one tap.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { AdminLectureRow, AdminQuizRow } from '@/api/types';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/admin/TreePicker', () => ({ TreePicker: () => null }));

const mockSetQuizStatus = { mutate: jest.fn(), isPending: false };
const mockSetAvailability = { mutate: jest.fn(), isPending: false };
let mockQuizzes: AdminQuizRow[] = [];
jest.mock('@/hooks/useQuizzes', () => ({
  useAdminQuizzes: () => ({ data: mockQuizzes, isLoading: false }),
  usePendingGradings: () => ({ data: [] }),
  useDeleteQuiz: () => ({ mutate: jest.fn(), isPending: false }),
  useSetQuizStatus: () => mockSetQuizStatus,
  useSetQuizAvailability: () => mockSetAvailability,
  useAdminQuiz: () => ({ data: mockAdminQuiz }),
  useCreateQuiz: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateQuiz: () => mockUpdateQuiz,
}));
const mockUpdateQuiz = { mutate: jest.fn(), isPending: false };
let mockAdminQuiz: unknown;

const mockSetLectureStatus = { mutate: jest.fn(), isPending: false };
let mockLectures: AdminLectureRow[] = [];
jest.mock('@/hooks/useAdmin', () => ({
  useAdminLectures: () => ({ data: mockLectures, isLoading: false }),
  useDeleteLecture: () => ({ mutate: jest.fn(), isPending: false }),
  useReorderLectures: () => ({ mutate: jest.fn(), isPending: false }),
  useSetLectureStatus: () => mockSetLectureStatus,
  useSheikhs: () => ({ data: [] }),
  useUpdateLecture: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useSections', () => ({ useSectionsFlat: () => ({ data: [] }) }));
jest.mock('@/lib/audioController', () => ({ playLecture: jest.fn() }));

import AdminLecturesScreen from '../../app/admin/lectures';
import QuizEditScreen from '../../app/admin/quiz-edit';
import AdminQuizzesScreen from '../../app/admin/quizzes';

const quiz = (over: Partial<AdminQuizRow> = {}): AdminQuizRow => ({
  id: 'q1',
  title: 'اختبار العقيدة الواسطية',
  sectionId: 's1',
  sectionTitle: 'العقيدة الواسطية',
  status: 'published',
  questionCount: 20,
  passScore: 50,
  order: 0,
  updatedAt: '2026-11-18T00:00:00Z',
  availabilityMode: 'open',
  availability: 'open',
  availableFrom: null,
  availableUntil: null,
  ...over,
} as AdminQuizRow);

beforeEach(() => {
  jest.clearAllMocks();
});

test('unpublishing a quiz asks first; nothing changes until «إلغاء النشر» is confirmed', async () => {
  mockQuizzes = [quiz()];
  await render(<AdminQuizzesScreen />);
  await fireEvent.press(screen.getByLabelText('إلغاء النشر'));
  expect(mockSetQuizStatus.mutate).not.toHaveBeenCalled();
  expect(screen.getByText('إلغاء نشر الاختبار؟')).toBeTruthy();

  await fireEvent.press(screen.getByText('تراجع'));
  expect(mockSetQuizStatus.mutate).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('إلغاء النشر'));
  await fireEvent.press(screen.getAllByText('إلغاء النشر').at(-1)!);
  expect(mockSetQuizStatus.mutate).toHaveBeenCalledWith(
    { quizId: 'q1', status: 'draft' },
    expect.anything(),
  );
});

test('closing a quiz asks first; re-opening a closed one is one tap', async () => {
  mockQuizzes = [quiz()];
  await render(<AdminQuizzesScreen />);
  await fireEvent.press(screen.getByLabelText('إغلاق الاختبار'));
  expect(mockSetAvailability.mutate).not.toHaveBeenCalled();
  expect(screen.getByText('إغلاق الاختبار؟')).toBeTruthy();
  await fireEvent.press(screen.getAllByText('إغلاق الاختبار').at(-1)!);
  expect(mockSetAvailability.mutate).toHaveBeenCalledWith({ quizId: 'q1', mode: 'closed' }, expect.anything());

  jest.clearAllMocks();
  mockQuizzes = [quiz({ availabilityMode: 'closed', availability: 'closed' } as Partial<AdminQuizRow>)];
  await render(<AdminQuizzesScreen />);
  await fireEvent.press(screen.getByLabelText('فتح الاختبار'));
  expect(mockSetAvailability.mutate).toHaveBeenCalledWith({ quizId: 'q1', mode: 'open' });
});

test('unpublishing a lecture asks first; nothing changes until confirmed', async () => {
  mockLectures = [
    {
      id: 'l1',
      title: 'غزوة تبوك (١)',
      sectionTitle: 'السيرة',
      sectionId: 's1',
      sheikhId: null,
      sheikhName: null,
      status: 'published',
      durationSec: 600,
      order: 0,
    },
  ];
  await render(<AdminLecturesScreen />);
  await fireEvent.press(screen.getByLabelText('إلغاء النشر'));
  expect(mockSetLectureStatus.mutate).not.toHaveBeenCalled();
  expect(screen.getByText('إلغاء نشر المحاضرة؟')).toBeTruthy();
  await fireEvent.press(screen.getAllByText('إلغاء النشر').at(-1)!);
  expect(mockSetLectureStatus.mutate).toHaveBeenCalledWith({ id: 'l1', status: 'draft' }, expect.anything());
});

// The editor: the owner's main case — hiding a quiz from inside its screen.
const publishedQuiz = (over: Record<string, unknown> = {}) => ({
  id: 'z1', sectionId: 's1', title: 'اختبار العقيدة الواسطية', description: null, passScore: 1,
  timeLimitSec: null, maxAttempts: null, showResult: true, showCorrectAnswers: false,
  status: 'published', order: 0, availabilityMode: 'open', availableFrom: null, availableUntil: null,
  questions: [
    { id: 'q1', text: 'سؤال', points: 2, order: 0, kind: 'mcq', modelAnswer: null,
      options: [ { id: 'o1', text: 'أ', isCorrect: true, order: 0 }, { id: 'o2', text: 'ب', isCorrect: false, order: 1 } ] },
  ],
  ...over,
});

test('editor: saving a published quiz as «مسودة» asks first', async () => {
  mockParams = { id: 'z1' };
  mockAdminQuiz = publishedQuiz();
  await render(<QuizEditScreen />);
  await fireEvent.press(screen.getByLabelText('مسودة'));
  await fireEvent.press(screen.getAllByText('حفظ كمسودة').at(-1)!);
  expect(mockUpdateQuiz.mutate).not.toHaveBeenCalled();
  expect(screen.getByText('إلغاء نشر الاختبار؟')).toBeTruthy();
  await fireEvent.press(screen.getAllByText('حفظ كمسودة').at(-1)!);
  expect(mockUpdateQuiz.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ quizId: 'z1', input: expect.objectContaining({ status: 'draft' }) }),
    expect.anything(),
  );
});

test('editor: switching a published quiz to «مغلق» asks first; an ordinary save does not', async () => {
  mockParams = { id: 'z1' };
  mockAdminQuiz = publishedQuiz();
  await render(<QuizEditScreen />);
  await fireEvent.press(screen.getByText('مغلق'));
  await fireEvent.press(screen.getAllByText('حفظ ونشر').at(-1)!);
  expect(mockUpdateQuiz.mutate).not.toHaveBeenCalled();
  expect(screen.getByText('إغلاق الاختبار؟')).toBeTruthy();
  await fireEvent.press(screen.getByText('حفظ وإغلاق'));
  expect(mockUpdateQuiz.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ availabilityMode: 'closed' }) }),
    expect.anything(),
  );

  jest.clearAllMocks();
  await render(<QuizEditScreen />);
  await fireEvent.press(screen.getAllByText('حفظ ونشر').at(-1)!);
  expect(mockUpdateQuiz.mutate).toHaveBeenCalledTimes(1);
});
