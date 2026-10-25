/**
 * فوائد الدارسين — one unified page: lecture-linked and general benefits,
 * newest first, anonymous; report for others' benefits, delete for one's own.
 */
import { fireEvent, render } from '@testing-library/react-native';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/hooks/useAuth', () => ({ useCurrentUser: () => ({ data: { isGuest: false } }) }));
jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));
jest.mock('@/hooks/useReports', () => ({
  useReportContent: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
jest.mock('@/hooks/useLecture', () => ({ useRecentLectures: () => ({ data: [], isLoading: false }) }));
jest.mock('@/hooks/useSearch', () => ({ useContentSearch: () => ({ data: null, isLoading: false }) }));

const mockFeed = jest.fn();
jest.mock('@/hooks/useBenefits', () => ({
  useBenefitsFeed: (kind: string) => {
    mockFeed(kind);
    return {
      data: {
        pages: [
          [
            {
              id: 'b1',
              body: 'التوحيد أول ما يُدعى إليه',
              isMine: false,
              createdAt: '2026-10-25T08:00:00Z',
              lectureId: 'L1',
              lectureTitle: 'الدرس الأول',
              sectionTitle: 'كتاب التوحيد',
              parentTitle: 'العقيدة',
            },
            {
              id: 'b2',
              body: 'من بركة العلم أن تنسب القول إلى قائله',
              isMine: true,
              createdAt: '2026-10-24T08:00:00Z',
              lectureId: null,
              lectureTitle: null,
              sectionTitle: null,
              parentTitle: null,
            },
          ],
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    };
  },
  useDeleteMyBenefit: () => ({ mutate: jest.fn(), isPending: false }),
  usePostBenefit: () => ({ mutate: jest.fn(), isPending: false }),
}));

import BenefitsScreen from '../../app/(student)/benefits';

test('shows lecture-linked and general benefits together, each with its source', async () => {
  const { getByText, getByLabelText } = await render(<BenefitsScreen />);
  expect(mockFeed).toHaveBeenLastCalledWith('all');
  expect(getByText('التوحيد أول ما يُدعى إليه')).toBeTruthy();
  expect(getByText(/فائدة عامة ·/)).toBeTruthy();
  await fireEvent.press(getByText('الدرس الأول'));
  expect(mockRouter.push).toHaveBeenCalledWith('/player/L1');
  // Own benefit → delete; another's → report (no approval step anywhere).
  expect(getByLabelText('حذف فائدتي')).toBeTruthy();
  expect(getByLabelText('الإبلاغ عن هذه الفائدة')).toBeTruthy();
});

test('filters: الكل / من المحاضرات / فوائد عامة / فوائدي', async () => {
  const { getByText } = await render(<BenefitsScreen />);
  await fireEvent.press(getByText('فوائد عامة'));
  expect(mockFeed).toHaveBeenLastCalledWith('general');
  await fireEvent.press(getByText('من المحاضرات'));
  expect(mockFeed).toHaveBeenLastCalledWith('lecture');
  await fireEvent.press(getByText('فوائدي'));
  expect(mockFeed).toHaveBeenLastCalledWith('mine');
});

test('the add sheet offers a lesson benefit or a general one', async () => {
  const { getByLabelText, getByText, getAllByText } = await render(<BenefitsScreen />);
  await fireEvent.press(getByLabelText('إضافة فائدة'));
  expect(getByText('فائدة من درس')).toBeTruthy();
  const general = getAllByText('فائدة عامة');
  await fireEvent.press(general[general.length - 1]);
  expect(getByLabelText('نص الفائدة')).toBeTruthy();
});
