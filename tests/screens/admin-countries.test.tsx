/**
 * «الطلاب حسب الدول 🌍» (dashboard card) + the users-page country filter (migration 0165).
 *
 * Invariants:
 *  - the card shows how many countries, the top 5 in server order (largest first), each with
 *    its flag + Arabic name + count; «عرض جميع الدول» shows the rest in place;
 *  - a row opens إدارة المستخدمين filtered to that country (`/admin/users?country=SD`);
 *  - 'ZZ' reads «غير محدد» (never a guessed country); no data → a calm empty line, no crash;
 *  - the users page reads `?country=` and passes it to the list query together with search and
 *    status; picking a country / «كل الدول» rewrites the URL param (refresh + direct link keep it).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), setParams: mockSetParams }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/hooks/useAdminGuard', () => ({ useAdminOnly: () => 'admin' }));

const mockUseAdminUsers = jest.fn();
let mockCounts: { country: string; users: number }[] | undefined;
jest.mock('@/hooks/useAdminUsers', () => ({
  useAdminUsers: (...args: unknown[]) => mockUseAdminUsers(...args),
  useAdminCountryCounts: () => ({ data: mockCounts, isLoading: false, refetch: jest.fn() }),
  useCreateUser: () => ({ mutate: jest.fn(), isPending: false }),
}));

import { CountriesCard, countriesPhrase } from '@/components/admin/CountriesCard';
import AdminUsers from '../../app/admin/users';

const PROD_SHAPE = [
  { country: 'SD', users: 2459 },
  { country: 'EG', users: 753 },
  { country: 'DZ', users: 171 },
  { country: 'SA', users: 58 },
  { country: 'LY', users: 50 },
  { country: 'MA', users: 49 },
  { country: 'ZZ', users: 2 },
];

beforeEach(() => {
  mockPush.mockClear();
  mockSetParams.mockClear();
  mockParams = {};
  mockCounts = PROD_SHAPE;
  mockUseAdminUsers.mockReset().mockReturnValue({
    data: [],
    totalCount: 0,
    isLoading: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
});

describe('CountriesCard', () => {
  test('title, number of countries, top 5 largest first with flag + Arabic name', async () => {
    await render(<CountriesCard rows={PROD_SHAPE} />);
    expect(screen.getByText('الطلاب حسب الدول 🌍')).toBeTruthy();
    expect(screen.getByText(countriesPhrase(7))).toBeTruthy();
    const names = ['السودان', 'مصر', 'الجزائر', 'السعودية', 'ليبيا'];
    for (const n of names) expect(screen.getByText(n)).toBeTruthy();
    // flags are decorative (hidden from screen readers — the name says it)
    for (const f of ['🇸🇩', '🇪🇬', '🇩🇿', '🇸🇦', '🇱🇾']) expect(screen.getByText(f, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('٢٤٥٩')).toBeTruthy(); // arNum, like every dashboard number
    expect(screen.queryByText('المغرب')).toBeNull(); // 6th: only after «عرض جميع الدول»
  });

  test('«عرض جميع الدول» shows the rest in place; ZZ reads «غير محدد»', async () => {
    await render(<CountriesCard rows={PROD_SHAPE} />);
    await fireEvent.press(screen.getByText('عرض جميع الدول'));
    expect(screen.getByText('المغرب')).toBeTruthy();
    expect(screen.getByText('غير محدد')).toBeTruthy();
    expect(screen.getByText('🌐', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByText('عرض أقل'));
    expect(screen.queryByText('المغرب')).toBeNull();
  });

  test('a country row opens the users page filtered to it', async () => {
    await render(<CountriesCard rows={PROD_SHAPE} />);
    await fireEvent.press(screen.getByText('السودان'));
    expect(mockPush).toHaveBeenCalledWith('/admin/users?country=SD');
  });

  test('no data → calm empty line; ≤ 5 countries → no «عرض جميع الدول»', async () => {
    await render(<CountriesCard rows={[]} />);
    expect(screen.getByText('لا توجد بيانات دول بعد.')).toBeTruthy();
    await render(<CountriesCard rows={[{ country: 'SD', users: 1 }]} />);
    expect(screen.getByText('طلاب من دولة واحدة')).toBeTruthy();
    expect(screen.queryByText('عرض جميع الدول')).toBeNull();
  });

  test('Arabic counted-noun agreement', () => {
    expect(countriesPhrase(2)).toBe('طلاب من دولتين');
    expect(countriesPhrase(3)).toMatch(/ دول$/);
    expect(countriesPhrase(18)).toMatch(/ دولة$/);
  });
});

describe('users page country filter', () => {
  const lastListCall = () => mockUseAdminUsers.mock.calls.at(-1) as unknown[];

  test('no ?country → «🌍 كل الدول», list unfiltered', async () => {
    await render(<AdminUsers />);
    expect(screen.getByText('كل الدول')).toBeTruthy();
    expect(lastListCall()[3]).toBeUndefined();
  });

  test('?country=SD (direct URL / from the dashboard) filters the list and labels the chip', async () => {
    mockParams = { country: 'SD' };
    await render(<AdminUsers />);
    expect(lastListCall()[3]).toBe('SD');
    expect(screen.getByText('السودان')).toBeTruthy();
    expect(screen.getByText('🇸🇩', { includeHiddenElements: true })).toBeTruthy();
  });

  test('country works together with status and search', async () => {
    jest.useFakeTimers();
    try {
      mockParams = { country: 'SA' };
      await render(<AdminUsers />);
      await fireEvent.press(screen.getByText('نشط'));
      await fireEvent.changeText(screen.getByPlaceholderText('ابحث بالاسم أو البريد أو الهاتف'), 'أحمد');
      await act(async () => {
        jest.advanceTimersByTime(350);
      });
      expect(lastListCall()).toEqual(['أحمد', false, 'active', 'SA']);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the dropdown lists the real countries with counts; picking one / «كل الدول» rewrites ?country', async () => {
    mockParams = { country: 'SD' };
    await render(<AdminUsers />);
    await fireEvent.press(screen.getByLabelText('تصفية حسب الدولة'));
    expect(screen.getByText('مصر')).toBeTruthy();
    expect(screen.getByText('٧٥٣')).toBeTruthy(); // count beside the country
    await fireEvent.press(screen.getByText('السعودية'));
    expect(mockSetParams).toHaveBeenLastCalledWith({ country: 'SA' });

    await fireEvent.press(screen.getByLabelText('تصفية حسب الدولة'));
    await fireEvent.press(screen.getAllByText('كل الدول').at(-1)!);
    expect(mockSetParams).toHaveBeenLastCalledWith({ country: undefined });
  });

  test('a junk ?country never filters or crashes', async () => {
    mockParams = { country: '249' };
    await render(<AdminUsers />);
    expect(lastListCall()[3]).toBeUndefined();
    expect(screen.getByText('كل الدول')).toBeTruthy();
  });
});
