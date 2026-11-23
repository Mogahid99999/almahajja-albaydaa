/**
 * مساحة الأسئلة — three independent sections (Concept 1): أسئلة عامة / فتاوى /
 * أسئلة المحاضرات. The first two are the existing board fixed to one category;
 * the third is display-only and every card links back to its source lesson.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/hooks/useAppContent', () => ({ useQnaNotice: () => ({ data: null }) }));
jest.mock('@/hooks/useAuth', () => ({ useCurrentUser: () => ({ data: { isGuest: false } }) }));
jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));
jest.mock('@/hooks/useRefreshAll', () => ({ useRefreshAll: () => jest.fn() }));
jest.mock('@/hooks/useReports', () => ({
  useReportContent: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
jest.mock('@/components/questions/AnswerThread', () => ({ AnswerThread: () => null }));

const mockPublic = jest.fn();
const mkQ = (over: object) => ({
  id: 'q1',
  body: 'هل يدخل في الباب ما يُعلَّق في السيارة؟',
  answerBody: 'نعم',
  answerAudioPath: null,
  askerDisplay: null,
  isMine: false,
  category: 'general',
  createdAt: '2026-10-20T10:00:00Z',
  answeredAt: '2026-10-21T10:00:00Z',
  ...over,
});
jest.mock('@/hooks/useQuestions', () => ({
  usePublicQuestions: (...args: unknown[]) => {
    mockPublic(...args);
    return { data: [], isLoading: false, refetch: jest.fn() };
  },
  useMyQuestions: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
  useAskQuestion: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteOwnQuestion: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateOwnQuestion: () => ({ mutate: jest.fn(), isPending: false }),
  useLectureQuestionsFeed: () => ({
    data: [
      mkQ({
        lectureId: 'L7',
        lectureTitle: 'الدرس السابع: باب من الشرك',
        sectionId: 'S1',
        sectionTitle: 'كتاب التوحيد',
        parentTitle: 'العقيدة',
      }),
      mkQ({
        id: 'q2',
        body: 'ما حكم الماء المتغير بطول المكث؟',
        lectureId: 'L3',
        lectureTitle: 'باب المياه',
        sectionId: 'S2',
        sectionTitle: 'عمدة الفقه',
        parentTitle: 'الفقه',
      }),
    ],
    isLoading: false,
    refetch: jest.fn(),
  }),
  useMyLectureQuestions: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
  useQuestionAnswers: (id: string) => ({ data: mockAnswers[id] }),
}));
const mockAnswers: Record<string, { body: string | null }[] | undefined> = {};

import QuestionsScreen from '../../app/(student)/questions';

beforeEach(() => {
  mockPublic.mockClear();
  mockRouter.push.mockClear();
});

test('shows the three sections; «أسئلة عامة» lists and asks general questions only', async () => {
  const { getByText, queryByText } = await render(<QuestionsScreen />);
  expect(getByText('أسئلة عامة')).toBeTruthy();
  expect(getByText('فتاوى')).toBeTruthy();
  expect(getByText('أسئلة المحاضرات')).toBeTruthy();
  expect(mockPublic).toHaveBeenLastCalledWith('general', undefined, 'general');
  // The old الكل/عام/فتوى filter row is gone from the fixed-category board.
  expect(queryByText('الكل')).toBeNull();
});

test('«فتاوى» is its own section with its own composer', async () => {
  const { getByText } = await render(<QuestionsScreen />);
  await fireEvent.press(getByText('فتاوى'));
  expect(mockPublic).toHaveBeenLastCalledWith('general', undefined, 'fatwa');
  expect(getByText('اطلب فتوى')).toBeTruthy();
});

test('«أسئلة المحاضرات» is display-only, filterable by series, and links to the source lesson', async () => {
  const { getByText, queryByText } = await render(<QuestionsScreen />);
  await fireEvent.press(getByText('أسئلة المحاضرات'));
  expect(queryByText('اسأل سؤالاً')).toBeNull(); // no composer here
  expect(getByText('العقيدة ← كتاب التوحيد')).toBeTruthy();
  await fireEvent.press(getByText('عمدة الفقه'));
  expect(queryByText('هل يدخل في الباب ما يُعلَّق في السيارة؟')).toBeNull();
  await fireEvent.press(getByText('باب المياه'));
  expect(mockRouter.push).toHaveBeenCalledWith('/player/L3');
});

test('owner 2026-11-23: «مشاركة» shares the question and «جواب الشيخ» apart; none for a voice-only answer', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  mockAnswers.q2 = [{ body: null }]; // voice only
  const { getByText, getAllByLabelText } = await render(<QuestionsScreen />);
  await fireEvent.press(getByText('أسئلة المحاضرات'));
  const buttons = getAllByLabelText('مشاركة السؤال والجواب');
  expect(buttons).toHaveLength(1);
  await fireEvent.press(buttons[0]);
  const msg = (share.mock.calls[0][0] as { message: string }).message;
  expect(msg.startsWith('❓ السؤال:\nهل يدخل في الباب ما يُعلَّق في السيارة؟\n\n✅ جواب الشيخ:\nنعم\n\n')).toBe(true);
  delete mockAnswers.q2;
  share.mockRestore();
});
