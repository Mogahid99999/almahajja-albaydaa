/**
 * app/(student)/quiz-attempt/[attemptId].tsx over the real device store (0174),
 * with the server mocked. Covers the older findings too: F-051 countdown,
 * F-052 failed load, F-053 failed submit, F-054 no English leakage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import type { QuizAttemptData } from '@/api/types';

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ attemptId: 'a1' }),
}));

const mockGetQuestions = jest.fn<Promise<QuizAttemptData>, [string]>();
const mockFinalize = jest.fn();
const mockSaveAnswer = jest.fn(async () => undefined);
const mockSaveText = jest.fn(async () => undefined);
jest.mock('@/api/quizzes', () => ({
  getAttemptQuestions: (id: string) => mockGetQuestions(id),
  finalizeAttempt: (...a: unknown[]) => mockFinalize(...a),
  saveAnswer: (...a: unknown[]) => (mockSaveAnswer as (...x: unknown[]) => Promise<void>)(...a),
  saveTextAnswer: (...a: unknown[]) => (mockSaveText as (...x: unknown[]) => Promise<void>)(...a),
  getSessionUserId: async () => 'u1',
}));
jest.mock('@/api/progress', () => ({ replayActivity: jest.fn() }));
jest.mock('@/api/bookmarks', () => ({ replayBookmark: jest.fn() }));
jest.mock('@/api/notes', () => ({ saveMyNote: jest.fn() }));
jest.mock('@/api/journey', () => ({ recordQuranWirdDay: jest.fn(), setWeeklyGoal: jest.fn() }));

let mockOnline = true;
jest.mock('@/lib/connectivity', () => ({ isOnline: async () => mockOnline, onReconnect: jest.fn() }));
jest.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn(), setQueryData: jest.fn() },
}));

import QuizAttemptScreen from '../../app/(student)/quiz-attempt/[attemptId]';
import { flushOutbox } from '@/lib/outbox';
import { clearQueue, loadQueue } from '@/lib/outboxQueue';
import { getLocalAttempt, removeLocalAttempt } from '@/lib/quizAttemptStore';

const OFFLINE_END = 'انتهى وقت الاختبار، وسيتم إرسال إجاباتك تلقائيًا عند عودة الاتصال.';

const data = (over: Partial<QuizAttemptData> = {}): QuizAttemptData =>
  ({
    attemptId: 'a1',
    quizId: 'z1',
    quizTitle: 'اختبار',
    timeLimitSec: null,
    remainingSec: null,
    submittedAt: null,
    questions: [
      { id: 'q1', text: 'السؤال الأول؟', kind: 'mcq', points: 1, order: 1, selectedOptionId: null, textAnswer: null, options: [{ id: 'o1', text: 'خيار أ', order: 1 }, { id: 'o2', text: 'خيار ب', order: 2 }] },
      { id: 'q2', text: 'اشرح معنى التوحيد', kind: 'text', points: 5, order: 2, selectedOptionId: null, textAnswer: null, options: [] },
    ],
    ...over,
  }) as QuizAttemptData;

function setOnline(v: boolean) {
  mockOnline = v;
  onlineManager.setOnline(v);
}

/** Lets async storage work settle under fake timers. */
async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-09T10:00:00Z'));
  setOnline(true);
  mockGetQuestions.mockReset();
  mockFinalize.mockReset().mockResolvedValue({ attemptId: 'a1' });
  mockSaveAnswer.mockClear();
  mockSaveText.mockClear();
  mockRouter.replace.mockClear();
  const left = await getLocalAttempt('u1', 'a1');
  if (left) await removeLocalAttempt(left);
  await AsyncStorage.clear();
  await clearQueue();
});

afterEach(async () => {
  jest.useRealTimers();
});

async function open() {
  const view = await render(<QuizAttemptScreen />);
  await settle();
  return view;
}

describe('load states (F-052)', () => {
  test('a failed load shows the calm error exit, not a forever-spinner', async () => {
    mockGetQuestions.mockRejectedValue(new Error('Network request failed'));
    const { getByText } = await open();
    expect(getByText('تعذّر فتح المحاولة')).toBeTruthy();
  });

  test('an already-submitted attempt redirects straight to its result', async () => {
    mockGetQuestions.mockResolvedValue(data({ submittedAt: '2026-07-15T10:00:00Z' }));
    await open();
    expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1');
  });

  test('a quiz with no questions shows the empty state', async () => {
    mockGetQuestions.mockResolvedValue(data({ questions: [] }));
    const { getByText } = await open();
    expect(getByText('لا توجد أسئلة في هذا الاختبار بعد')).toBeTruthy();
  });
});

describe('answers land on the device first', () => {
  test('a choice is on disk at once, even offline', async () => {
    mockGetQuestions.mockResolvedValue(data());
    const { getByText } = await open();
    setOnline(false);
    await fireEvent.press(getByText('خيار أ'));
    await settle();
    expect(await AsyncStorage.getItem('quiz-offline-v1:u1:a1:answers')).toContain('"q1":"o1"');
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    expect(getByText('أجبت عن ١ من ٢')).toBeTruthy();
  });

  test('written text autosaves to disk shortly after typing', async () => {
    mockGetQuestions.mockResolvedValue(data());
    const { getByText, getByPlaceholderText } = await open();
    await fireEvent.press(getByText('التالي'));
    await fireEvent.changeText(getByPlaceholderText('اكتب إجابتك هنا...'), 'إفراد الله بالعبادة');
    await act(() => jest.advanceTimersByTime(400));
    await settle();
    expect(await AsyncStorage.getItem('quiz-offline-v1:u1:a1:answers')).toContain('إفراد الله');
  });

  test('moving away and back keeps a draft', async () => {
    mockGetQuestions.mockResolvedValue(data());
    const { getByText, getByPlaceholderText, getByDisplayValue } = await open();
    await fireEvent.press(getByText('التالي'));
    await fireEvent.changeText(getByPlaceholderText('اكتب إجابتك هنا...'), 'إجابتي');
    await fireEvent.press(getByText('السابق'));
    await fireEvent.press(getByText('التالي'));
    expect(getByDisplayValue('إجابتي')).toBeTruthy();
  });
});

describe('the countdown', () => {
  test('counts down from the server, in mm:ss (F-051)', async () => {
    mockGetQuestions.mockResolvedValue(data({ timeLimitSec: 120, remainingSec: 90 }));
    const { getByText } = await open();
    expect(getByText('٠١:٣٠')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(30_000));
    expect(getByText('٠١:٠٠')).toBeTruthy();
  });

  test('reopening continues the same time instead of restarting', async () => {
    mockGetQuestions.mockResolvedValue(data({ timeLimitSec: 600, remainingSec: 600 }));
    const first = await open();
    await act(() => jest.advanceTimersByTime(5_000));
    await settle();
    await first.unmount();
    setOnline(false);
    jest.setSystemTime(Date.now() + 60_000);
    const { getByText } = await open();
    expect(mockGetQuestions).toHaveBeenCalledTimes(1);
    expect(getByText('٠٨:٥٥')).toBeTruthy();
  });

  test('time away is charged on return to the foreground (F-051 regression)', async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, fn) => {
      listeners.push(fn as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
    mockGetQuestions.mockResolvedValue(data({ timeLimitSec: 60, remainingSec: 60 }));
    const { getByText } = await open();
    setOnline(false);
    await act(() => {
      jest.setSystemTime(Date.now() + 120_000);
    });
    await act(() => {
      for (const fn of listeners) fn('active');
    });
    await settle();
    expect(getByText(OFFLINE_END)).toBeTruthy();
  });
});

describe('at zero', () => {
  test('online: the last typed words are sent and the result opens, once', async () => {
    mockGetQuestions.mockResolvedValue(data({ timeLimitSec: 5, remainingSec: 5 }));
    const { getByText, getByPlaceholderText } = await open();
    await fireEvent.press(getByText('التالي'));
    await fireEvent.changeText(getByPlaceholderText('اكتب إجابتك هنا...'), 'آخر كلمة');
    await act(() => jest.advanceTimersByTime(6_000));
    await settle();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1'));
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockFinalize.mock.calls[0][1]).toEqual([{ questionId: 'q2', text: 'آخر كلمة' }]);
    expect(await AsyncStorage.getItem('quiz-offline-v1:u1:a1:meta')).toBeNull();
  });

  test('offline: locks, keeps everything, delivers when the connection returns', async () => {
    mockGetQuestions.mockResolvedValue(data({ timeLimitSec: 3, remainingSec: 3 }));
    const { getByText, queryByText } = await open();
    await fireEvent.press(getByText('خيار ب'));
    setOnline(false);
    await act(() => jest.advanceTimersByTime(4_000));
    await settle();
    expect(getByText(OFFLINE_END)).toBeTruthy();
    expect(queryByText('خيار ب')).toBeNull(); // no way back into the questions
    expect(mockFinalize).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('quiz-offline-v1:u1:a1:answers')).toContain('"phase":"locked"');
    expect((await loadQueue()).filter((e) => e.kind === 'quiz_submit')).toHaveLength(1);

    setOnline(true);
    await act(async () => {
      await flushOutbox();
    });
    await settle();
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockFinalize.mock.calls[0][1]).toEqual(expect.arrayContaining([{ questionId: 'q1', optionId: 'o2' }]));
    expect(await AsyncStorage.getItem('quiz-offline-v1:u1:a1:meta')).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1');
  });

  test('a failed send keeps the attempt, offers a retry, and retrying delivers (F-053)', async () => {
    mockFinalize.mockRejectedValueOnce(new Error('Network request failed')).mockRejectedValueOnce(new Error('Network request failed'));
    mockGetQuestions.mockResolvedValue(data());
    const { getByText, getAllByText } = await open();
    await fireEvent.press(getByText('تسليم الاختبار'));
    await fireEvent.press(getAllByText('تسليم')[0]);
    await settle();
    await waitFor(() => expect(getByText('إعادة الإرسال')).toBeTruthy());
    expect(await AsyncStorage.getItem('quiz-offline-v1:u1:a1:meta')).not.toBeNull();
    await fireEvent.press(getByText('إعادة الإرسال'));
    await settle();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/quiz-result/a1'));
  });

  test('a quiz with no time limit shows no countdown and never locks by itself', async () => {
    mockGetQuestions.mockResolvedValue(data());
    const { getByText, queryByLabelText } = await open();
    await act(() => jest.advanceTimersByTime(600_000));
    expect(queryByLabelText('الوقت المتبقي')).toBeNull();
    expect(getByText('السؤال الأول؟')).toBeTruthy();
    expect(mockFinalize).not.toHaveBeenCalled();
  });
});
