/**
 * «الجدول الأسبوعي» (0158) — owner 2026-10-05: «جيد طبقه مع إمكانية تأجيل او
 * إلغاء درس اي يوم او تعديله» · «عا الصلاحية لجميع المشرفين».
 *
 * Invariants:
 *  - Home «دروس اليوم»: today's lessons by Mecca time with «بعد ساعة», and
 *    «مباشر الآن» on the lesson whose section is live; hidden when the schedule
 *    is empty (no empty card, no gap);
 *  - the schedule screen: today first; a date changed alone reads on that day
 *    («لا درس في هذا الموعد — …»); «حسب الشيخ» merges one lesson at two times
 *    («موعدان»); a lesson opens its sheet with «ذكّرني» and its section;
 *  - /admin/schedule (every moderator): a date of a lesson is cancelled /
 *    postponed / retimed alone, with an undo per change; a lesson is deleted
 *    only after asking; the form says what is missing before saving.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Schedule, ScheduleItem } from '@/api/schedule';
import { homeScheduleRows, ScheduleTodayCard } from '@/components/home/ScheduleTodayCard';
import { startMs } from '@/lib/schedule';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockState: { schedule: Schedule | undefined } = { schedule: undefined };
const mockSaveItem = jest.fn();
const mockSetActive = jest.fn();
const mockDeleteItem = jest.fn();
const mockSaveException = jest.fn();
const mockDeleteException = jest.fn();
jest.mock('@/hooks/useSchedule', () => ({
  useSchedule: () => ({
    data: mockState.schedule,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
  useScheduleReminderSync: () => undefined,
  useSaveScheduleItem: () => ({ mutate: mockSaveItem, isPending: false }),
  useSetScheduleItemActive: () => ({ mutate: mockSetActive, isPending: false }),
  useDeleteScheduleItem: () => ({ mutate: mockDeleteItem, isPending: false }),
  useSaveScheduleException: () => ({ mutate: mockSaveException, isPending: false }),
  useDeleteScheduleException: () => ({ mutate: mockDeleteException, isPending: false }),
}));
const mockLiveNow: { current: unknown } = { current: null };
jest.mock('@/hooks/useLive', () => ({ useLiveNow: () => ({ data: mockLiveNow.current }) }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));
jest.mock('@/lib/notifications', () => ({ ensurePermission: jest.fn(async () => true) }));
jest.mock('@/hooks/useAdmin', () => ({
  useSheikhs: () => ({ data: [{ id: 'sh1', name: 'الشيخ النذير محمد' }] }),
}));
jest.mock('@/components/admin/TreePicker', () => ({ TreePicker: () => null }));
jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));

const item = (over: Partial<ScheduleItem> & Pick<ScheduleItem, 'id' | 'title' | 'days' | 'startTime'>): ScheduleItem => ({
  subtitle: null,
  subject: null,
  sheikhId: null,
  sheikhName: 'الشيخ النذير محمد',
  sectionId: null,
  sectionTitle: null,
  audience: 'all',
  durationMin: 60,
  note: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

// Monday 2026-10-05 (dow 1). A: Sunday + Thursday 21:30; C: daily except Friday 17:00.
const A = item({ id: 'A', title: 'كتاب التوحيد', days: [0, 4], startTime: '21:30', sectionId: 'sec-tawhid' });
const B = item({ id: 'B', title: 'الأربعون النووية', days: [2], startTime: '21:30' });
const B2 = item({ id: 'B2', title: 'الأربعون النووية', days: [5], startTime: '17:00' });
const C = item({ id: 'C', title: 'قصص الأنبياء', days: [0, 1, 2, 3, 4, 6], startTime: '17:00', sheikhName: 'الشيخ معروف محمد بركة', sectionId: 'sec-qisas' });
const HIDDEN = item({ id: 'H', title: 'درس موقوف', days: [1], startTime: '10:00', isActive: false });

const SCHEDULE: Schedule = {
  version: '1',
  items: [A, B, B2, C],
  exceptions: [
    { id: 'e1', itemId: 'A', occursOn: '2026-10-08', kind: 'cancelled', newDate: null, newTime: null, note: 'لسفر الشيخ' },
  ],
  canEdit: false,
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(startMs('2026-10-05', '16:00'));
  mockState.schedule = SCHEDULE;
  mockLiveNow.current = null;
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

describe('Home «دروس اليوم»', () => {
  test('today’s lessons still ahead, with «بعد ساعة»', async () => {
    await render(<ScheduleTodayCard />);
    expect(screen.getByText('دروس اليوم')).toBeTruthy();
    expect(screen.getByText('قصص الأنبياء')).toBeTruthy();
    expect(screen.getByText('بعد ساعة')).toBeTruthy();
    await fireEvent.press(screen.getByText('الجدول الأسبوعي كاملاً'));
    expect(mockRouter.push).toHaveBeenCalledWith('/(student)/schedule');
  });

  test('«مباشر الآن» on the lesson whose section is on air', async () => {
    jest.setSystemTime(startMs('2026-10-05', '17:10'));
    await render(<ScheduleTodayCard liveSectionId="sec-qisas" />);
    expect(screen.getByText('مباشر الآن')).toBeTruthy();
  });

  test('nothing left today → the next lesson, titled with its day', () => {
    const view = homeScheduleRows(SCHEDULE, startMs('2026-10-05', '18:30'))!;
    expect(view.title).toBe('الدرس القادم · غداً');
    expect(view.rows.map((o) => o.item.id)).toEqual(['C']);
  });

  test('an empty schedule renders nothing (no empty card, no gap)', async () => {
    mockState.schedule = { ...SCHEDULE, items: [], exceptions: [] };
    await render(<ScheduleTodayCard containerStyle={{ marginBottom: 28 }} />);
    expect(screen.toJSON()).toBeNull();
  });
});

describe('the schedule screen', () => {
  // Loaded lazily so the mocks above apply.
  const Screen = () => {
    const ScheduleScreen = require('../../app/(student)/schedule').default;
    return <ScheduleScreen />;
  };

  test('today first; a cancelled date reads on its day with the reason', async () => {
    await render(<Screen />);
    expect(screen.getByText('جميع الأوقات بتوقيت مكة المكرمة')).toBeTruthy();
    expect(screen.getByText('الدرس القادم: اليوم ٥:٠٠ عصراً')).toBeTruthy();
    await fireEvent.press(screen.getByText('خميس'));
    expect(screen.getByText('لا درس في هذا الموعد — لسفر الشيخ')).toBeTruthy();
  });

  test('«حسب الشيخ»: one lesson at two times is one row «موعدان»', async () => {
    await render(<Screen />);
    await fireEvent.press(screen.getByText('حسب الشيخ'));
    expect(screen.getByText('موعدان')).toBeTruthy();
    expect(screen.getByText('كل ثلاثاء ٩:٣٠ مساءً · كل جمعة ٥:٠٠ عصراً')).toBeTruthy();
  });

  test('a lesson opens its sheet: «ذكّرني» and its section', async () => {
    await render(<Screen />);
    await fireEvent.press(screen.getByText('حسب الشيخ'));
    await fireEvent.press(screen.getByText('كتاب التوحيد'));
    expect(screen.getByText('ذكّرني قبل الدرس')).toBeTruthy();
    await fireEvent.press(screen.getByText('دروس هذا الكتاب في التطبيق'));
    expect(mockRouter.push).toHaveBeenCalledWith('/(student)/section/sec-tawhid');
  });

  test('no schedule yet → a calm empty state, in Arabic', async () => {
    mockState.schedule = { ...SCHEDULE, items: [], exceptions: [] };
    await render(<Screen />);
    expect(screen.getByText('لم يُنشر الجدول بعد')).toBeTruthy();
  });
});

describe('/admin/schedule', () => {
  const Admin = () => {
    const AdminScheduleScreen = require('../../app/admin/schedule').default;
    return <AdminScheduleScreen />;
  };

  beforeEach(() => {
    mockState.schedule = { ...SCHEDULE, items: [A, HIDDEN], canEdit: true };
  });

  test('a hidden lesson is marked; saved changes list with an undo', async () => {
    await render(<Admin />);
    expect(screen.getByText('مخفي عن الطلاب')).toBeTruthy();
    expect(screen.getByText('الخميس ٨ أكتوبر — أُلغي (لسفر الشيخ)')).toBeTruthy();
    await fireEvent.press(screen.getByText('تراجع'));
    expect(mockDeleteException).toHaveBeenCalledWith('e1', expect.anything());
  });

  test('cancel one date alone', async () => {
    await render(<Admin />);
    await fireEvent.press(screen.getAllByText('تغيير يوم')[0]);
    // The first date after today: Sunday 11 (Thursday 8 already has a change → prefilled).
    await fireEvent.press(screen.getByText('الأحد ١١ أكتوبر'));
    await fireEvent.press(screen.getByText('إلغاء هذا اليوم'));
    await fireEvent.press(screen.getByText('حفظ التغيير'));
    expect(mockSaveException).toHaveBeenCalledWith(
      { itemId: 'A', occursOn: '2026-10-11', kind: 'cancelled', newDate: null, newTime: null, note: '' },
      expect.anything(),
    );
  });

  test('postponing needs the new day — said in Arabic, nothing saved', async () => {
    await render(<Admin />);
    await fireEvent.press(screen.getAllByText('تغيير يوم')[0]);
    await fireEvent.press(screen.getByText('الأحد ١١ أكتوبر'));
    await fireEvent.press(screen.getByText('تأجيل إلى يوم آخر'));
    await fireEvent.press(screen.getByText('حفظ التغيير'));
    expect(screen.getByText('اختر اليوم الذي يُؤجَّل إليه الدرس.')).toBeTruthy();
    expect(mockSaveException).not.toHaveBeenCalled();
  });

  test('a new lesson without a title is not sent', async () => {
    await render(<Admin />);
    await fireEvent.press(screen.getByText('إضافة درس'));
    await fireEvent.press(screen.getByText('حفظ'));
    expect(screen.getByText('اكتب عنوان الدرس.')).toBeTruthy();
    expect(mockSaveItem).not.toHaveBeenCalled();
  });

  test('delete asks first', async () => {
    await render(<Admin />);
    await fireEvent.press(screen.getAllByText('حذف')[0]);
    expect(screen.getByText('حذف الدرس من الجدول')).toBeTruthy();
    expect(mockDeleteItem).not.toHaveBeenCalled();
    const buttons = screen.getAllByText('حذف');
    await fireEvent.press(buttons[buttons.length - 1]);
    expect(mockDeleteItem).toHaveBeenCalledWith('A', expect.anything());
  });
});
