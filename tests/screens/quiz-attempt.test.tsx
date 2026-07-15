/**
 * app/(student)/quiz-attempt/[attemptId].tsx — the phase-8 defect cluster
 * (F-051 countdown freeze, F-052 spinner-forever on failed load, F-053 silent
 * submit failure, F-054 English error leakage).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn(), canGoBack: () => true };
let mockSearchParams: Record<string, string> = { attemptId: 'a1' };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockSearchParams,
}));

type AttemptData = {
  remainingSec: number | null;
  submittedAt: string | null;
  questions: {
    id: string;
    text: string;
    options: { id: string; text: string }[];
    selectedOptionId: string | null;
  }[];
};

const mockAttemptQuery: { data: AttemptData | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const mockSaveAnswer = { mutate: jest.fn(), mutateAsync: jest.fn(async () => undefined) };
const mockSubmitAttempt = { mutate: jest.fn(), isPending: false };

jest.mock('@/hooks/useQuizzes', () => ({
  useAttemptQuestions: () => mockAttemptQuery,
  useSaveAnswer: () => mockSaveAnswer,
  useSubmitAttempt: () => mockSubmitAttempt,
}));

import QuizAttemptScreen from '../../app/(student)/quiz-attempt/[attemptId]';

const twoQuestions = (): AttemptData => ({
  remainingSec: null,
  submittedAt: null,
  questions: [
    {
      id: 'q1',
      text: 'السؤال الأول؟',
      options: [
        { id: 'o1', text: 'خيار أ' },
        { id: 'o2', text: 'خيار ب' },
      ],
      selectedOptionId: null,
    },
    {
      id: 'q2',
      text: 'السؤال الثاني؟',
      options: [
        { id: 'o3', text: 'خيار ج' },
        { id: 'o4', text: 'خيار د' },
      ],
      selectedOptionId: null,
    },
  ],
});

beforeEach(() => {
  mockSearchParams = { attemptId: 'a1' };
  mockAttemptQuery.data = undefined;
  mockAttemptQuery.isLoading = false;
  mockAttemptQuery.isError = false;
  mockSubmitAttempt.isPending = false;
  // clearMocks only clears calls — implementations set inside a test would
  // otherwise leak into the next one.
  mockSaveAnswer.mutate.mockReset();
  mockSaveAnswer.mutateAsync.mockReset().mockResolvedValue(undefined);
  mockSubmitAttempt.mutate.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('load states (F-052)', () => {
  test('a failed load shows the calm error exit, not a forever-spinner', async () => {
    mockAttemptQuery.isError = true;
    const { getByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('العودة'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(getByText('تعذّر فتح المحاولة')).toBeTruthy();
  });

  test('an already-submitted attempt redirects straight to its result', async () => {
    mockAttemptQuery.data = { ...twoQuestions(), submittedAt: '2026-07-15T10:00:00Z' };
    await render(<QuizAttemptScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1');
  });

  test('a quiz with no questions shows the empty state', async () => {
    mockAttemptQuery.data = { remainingSec: null, submittedAt: null, questions: [] };
    const { getByText } = await render(<QuizAttemptScreen />);
    expect(getByText('لا توجد أسئلة في هذا الاختبار بعد')).toBeTruthy();
  });
});

describe('answering and navigation', () => {
  test('picking an option saves it and moves the answered counter', async () => {
    mockAttemptQuery.data = twoQuestions();
    const { getByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('خيار أ'));
    expect(mockSaveAnswer.mutate).toHaveBeenCalledWith(
      { attemptId: 'a1', questionId: 'q1', optionId: 'o1' },
      expect.anything(),
    );
    expect(getByText('أجبت عن ١ من ٢')).toBeTruthy();
  });

  test('a failed answer-save surfaces the server’s Arabic reason verbatim (F-054)', async () => {
    mockAttemptQuery.data = twoQuestions();
    mockSaveAnswer.mutate.mockImplementation((_vars, cbs) =>
      cbs.onError(new Error('انتهى وقت الاختبار')),
    );
    const { getByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('خيار أ'));
    expect(getByText('انتهى وقت الاختبار')).toBeTruthy();
  });

  test('English save-failure noise becomes the generic connectivity line', async () => {
    mockAttemptQuery.data = twoQuestions();
    mockSaveAnswer.mutate.mockImplementation((_vars, cbs) =>
      cbs.onError(new Error('Network request failed')),
    );
    const { getByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('خيار أ'));
    expect(
      getByText('تعذّر حفظ الإجابة — تحقق من الاتصال، وسيُعاد الحفظ عند التسليم.'),
    ).toBeTruthy();
  });

  test('التالي moves to the next question', async () => {
    mockAttemptQuery.data = twoQuestions();
    const { getByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('التالي'));
    expect(getByText('السؤال الثاني؟')).toBeTruthy();
    expect(getByText('السؤال ٢ من ٢')).toBeTruthy();
  });
});

describe('submit (F-053)', () => {
  test('a failed submit shows the failure banner and stays retryable', async () => {
    mockAttemptQuery.data = twoQuestions();
    mockSubmitAttempt.mutate.mockImplementation((_id, cbs) =>
      cbs.onError(new Error('Network request failed')),
    );
    const { getByText, getAllByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('تسليم الاختبار')); // early-submit affordance opens the sheet
    await fireEvent.press(getAllByText('تسليم')[0]); // confirm inside the sheet
    await waitFor(() =>
      expect(
        getByText('تعذّر تسليم الاختبار — تحقق من الاتصال ثم أعد المحاولة.'),
      ).toBeTruthy(),
    );

    // Retry is NOT locked out: a second confirm reaches the server again.
    mockSubmitAttempt.mutate.mockImplementation((_id, cbs) => cbs.onSuccess());
    await fireEvent.press(getByText('تسليم الاختبار'));
    await fireEvent.press(getAllByText('تسليم')[0]);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1'));
  });

  test('a successful submit navigates to the result and never double-fires', async () => {
    mockAttemptQuery.data = twoQuestions();
    mockSubmitAttempt.mutate.mockImplementation((_id, cbs) => cbs.onSuccess());
    const { getByText, getAllByText } = await render(<QuizAttemptScreen />);
    await fireEvent.press(getByText('تسليم الاختبار'));
    await fireEvent.press(getAllByText('تسليم')[0]);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1'));
    expect(mockSubmitAttempt.mutate).toHaveBeenCalledTimes(1);
  });
});

describe('timed countdown on the wall clock (F-051)', () => {
  test('counts down from the server-seeded remaining seconds', async () => {
    jest.useFakeTimers();
    mockAttemptQuery.data = { ...twoQuestions(), remainingSec: 90 };
    const { getByText } = await render(<QuizAttemptScreen />);
    expect(getByText('١:٣٠')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(30_000));
    expect(getByText('١:٠٠')).toBeTruthy();
  });

  test('auto-submits when the wall-clock deadline passes', async () => {
    jest.useFakeTimers();
    mockAttemptQuery.data = { ...twoQuestions(), remainingSec: 5 };
    await render(<QuizAttemptScreen />);
    expect(mockSubmitAttempt.mutate).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(6_000));
    expect(mockSubmitAttempt.mutate).toHaveBeenCalledWith('a1', expect.anything());
  });

  test('time spent "backgrounded" is charged on the first foreground tick — the F-051 regression', async () => {
    jest.useFakeTimers();
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      listeners.push(fn as (s: string) => void);
      return { remove: jest.fn() } as never;
    });

    mockAttemptQuery.data = { ...twoQuestions(), remainingSec: 60 };
    await render(<QuizAttemptScreen />);

    // Simulate background: the JS timer never fires, but wall time moves on
    // past the deadline (a phone call longer than the remaining minute).
    await act(() => {
      jest.setSystemTime(Date.now() + 120_000);
    });
    expect(mockSubmitAttempt.mutate).not.toHaveBeenCalled();

    // Foreground: the AppState tick recomputes from the wall clock and fires
    // the auto-submit immediately (the old counter would have shown a frozen
    // «١:٠٠» and never submitted).
    await act(() => {
      for (const fn of listeners) fn('active');
    });
    expect(mockSubmitAttempt.mutate).toHaveBeenCalledWith('a1', expect.anything());
  });

  test('a failed auto-submit retries on a later tick', async () => {
    jest.useFakeTimers();
    mockAttemptQuery.data = { ...twoQuestions(), remainingSec: 2 };
    mockSubmitAttempt.mutate.mockImplementation((_id, cbs) =>
      cbs.onError(new Error('Network request failed')),
    );
    await render(<QuizAttemptScreen />);
    // The auto-submit retries on EVERY tick past the deadline while it keeps
    // failing, so advance to exactly the deadline tick for a deterministic count.
    await act(() => jest.advanceTimersByTime(2_000));
    expect(mockSubmitAttempt.mutate).toHaveBeenCalledTimes(1);

    mockSubmitAttempt.mutate.mockImplementation((_id, cbs) => cbs.onSuccess());
    await act(() => jest.advanceTimersByTime(1_000));
    expect(mockSubmitAttempt.mutate).toHaveBeenCalledTimes(2);
    expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1');
  });
});
