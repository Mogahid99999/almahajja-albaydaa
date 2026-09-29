/**
 * app/admin/unclassified.tsx — live recordings in «المحاضرات الواردة»
 * (V23 P6, PLAN_LIVE_V23 §8, §15 `admin`).
 *
 * Invariants:
 *  - a live draft carries «من بث مباشر» and asks ONLY for
 *    «مطلوب منك: العنوان النهائي والشيخ» — both pre-filled (preliminary title,
 *    the server's sheikh suggestion marked «مقترح»);
 *  - the section is shown FIXED with «تغيير»; the order stays automatic;
 *  - «المداخلات» lists who spoke and when (real names, D2);
 *  - «نشر» asks first, then admin_save_live_lecture publishes WITH the
 *    notification; switching «إشعار الطلاب» off makes it «نشر بدون إشعار»;
 *    «حفظ دون نشر» saves at once without publishing;
 *  - Enter in the title = «نشر» (keyboard-first, the < 1 minute exit criterion);
 *  - a bad title / no sheikh blocks saving; recordings still on their way show
 *    «جارٍ الضغط على الخادم».
 */
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams.current,
}));

jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/admin/TreePicker', () => {
  const { Pressable, Text } = require('react-native');
  return {
    TreePicker: ({ onChange }: { onChange: (id: string) => void }) => (
      <Pressable onPress={() => onChange('sec-2')}>
        <Text>اختيار قسم آخر</Text>
      </Pressable>
    ),
  };
});
jest.mock('@/hooks/useSections', () => ({
  useSectionsFlat: () => ({
    data: [
      { id: 'sec-1', title: 'كتاب التوحيد', parentId: 'root', depth: 1, path: ['العقيدة', 'كتاب التوحيد'], order: 1 },
      { id: 'sec-2', title: 'الأصول الثلاثة', parentId: 'root', depth: 1, path: ['العقيدة', 'الأصول الثلاثة'], order: 2 },
    ],
  }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: { role: 'publisher', isGuest: false } }),
}));

type Mutation = { mutate: jest.Mock; isPending: boolean; variables?: unknown };
const mk = (): Mutation => ({ mutate: jest.fn(), isPending: false });
const mockAdmin = { classify: mk(), setStatus: mk() };
jest.mock('@/hooks/useAdmin', () => ({
  useUnclassifiedLectures: () => ({ data: [], isLoading: false }),
  useClassifyLecture: () => mockAdmin.classify,
  useSetLectureStatus: () => mockAdmin.setStatus,
  useSheikhs: () => ({
    data: [
      { id: 'sh1', name: 'الشيخ عبد الله' },
      { id: 'sh2', name: 'الشيخ محمد' },
    ],
  }),
}));

const mockLive = {
  inbox: null as unknown,
  save: mk(),
  retry: mk(),
  interventions: [] as unknown[],
};
jest.mock('@/hooks/useLiveAdmin', () => ({
  useLiveInbox: () => ({ data: mockLive.inbox, isLoading: false }),
  useSaveLiveLecture: () => mockLive.save,
  useRetryLiveRecording: () => mockLive.retry,
  useLiveInterventions: (id: string | null) => ({
    data: id ? mockLive.interventions : undefined,
    isLoading: false,
    isError: false,
  }),
}));

import UnclassifiedScreen from '../../app/admin/unclassified';

const draft = {
  lectureId: 'lec-1',
  title: 'شرح كتاب التوحيد',
  sectionId: 'sec-1',
  sectionTitle: 'كتاب التوحيد',
  order: 7,
  sheikhId: null,
  suggestedSheikhId: 'sh1',
  suggestedSheikhName: 'الشيخ عبد الله',
  durationSec: 3252,
  createdAt: '2026-09-29T18:10:00Z',
  notifyOnPublish: true,
  sessionId: 's1',
  sessionTitle: 'شرح كتاب التوحيد',
  startedAt: '2026-09-29T17:00:00Z',
  endedAt: '2026-09-29T18:00:00Z',
  peakListeners: 42,
};

const compressing = {
  id: 's2',
  title: 'مجلس يُضغط الآن',
  status: 'processing',
  sectionId: 'sec-1',
  sectionTitle: 'كتاب التوحيد',
  sheikhId: null,
  sheikhName: null,
  hostUserId: 'u1',
  hostName: null,
  isMine: false,
  scheduledAt: null,
  startedAt: '2026-09-29T19:00:00Z',
  endedAt: '2026-09-29T20:00:00Z',
  createdAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
  attendees: 0,
  lectureId: null,
  lectureStatus: null,
  lectureNeedsTitle: false,
  durationSec: null,
  rawLocal: true,
  rawBackup: false,
  job: { id: 'j1', status: 'running', progress: 0.42, attempts: 1, error: null },
};

const realOS = Platform.OS;
beforeEach(() => {
  (Platform as { OS: string }).OS = 'android';
  mockParams.current = {};
  mockLive.save = mk();
  mockLive.retry = mk();
  mockLive.inbox = { drafts: [draft], pending: [] };
  mockLive.interventions = [
    {
      identity: 'a1b2c3d4e5f60718',
      displayName: 'أحمد محمد',
      hiddenName: false,
      gender: 'm',
      role: 'speaker',
      spokeSeconds: 135,
      stints: [{ fromAt: 'x', toAt: 'y', fromSec: 750, toSec: 885 }],
    },
    {
      identity: 'b1b2c3d4e5f60718',
      displayName: 'فاطمة علي',
      hiddenName: true,
      gender: 'f',
      role: 'speaker',
      spokeSeconds: 50,
      stints: [{ fromAt: 'x', toAt: 'y', fromSec: 2050, toSec: 2100 }],
    },
  ];
});
afterAll(() => {
  (Platform as { OS: string }).OS = realOS;
});

const saved = () => mockLive.save.mutate.mock.calls[0]?.[0];

test('a live draft: «من بث مباشر», only the two required fields, pre-filled', async () => {
  await render(<UnclassifiedScreen />);
  expect(screen.getByText('من بث مباشر')).toBeTruthy();
  expect(screen.getByText('مطلوب منك: العنوان النهائي والشيخ')).toBeTruthy();
  expect(screen.getByDisplayValue('شرح كتاب التوحيد')).toBeTruthy();
  expect(screen.getByText('الشيخ عبد الله')).toBeTruthy();
  expect(screen.getByText('مقترح')).toBeTruthy();
  // Section fixed (path), with «تغيير»; order automatic.
  expect(screen.getByText('كتاب التوحيد')).toBeTruthy();
  expect(screen.getByText('تغيير')).toBeTruthy();
  expect(screen.getByText('الترتيب تلقائي: رقم ٧ في القسم')).toBeTruthy();
  // No manual order field / section picker for a live item.
  expect(screen.queryByText('رقم الترتيب')).toBeNull();
  expect(screen.queryByText('اختيار قسم آخر')).toBeNull();
  expect(screen.getByText('١ محاضرة تنتظر المراجعة والنشر')).toBeTruthy();
});

test('«المداخلات»: who spoke and when, real names for staff (D2)', async () => {
  await render(<UnclassifiedScreen />);
  expect(screen.getByText('مداخلتان')).toBeTruthy();
  expect(screen.getByText('أحمد محمد')).toBeTruthy();
  expect(screen.getByText(/عند ١٢:٣٠–١٤:٤٥ · تحدّث ٢:١٥/)).toBeTruthy();
  expect(screen.getByText('فاطمة علي (اختارت «بدون اسم»)')).toBeTruthy();
  expect(screen.getByText(/عند ٣٤:١٠–٣٥:٠٠ · تحدّثت ٠:٥٠/)).toBeTruthy();
});

test('«نشر» confirms, then publishes WITH the notification', async () => {
  await render(<UnclassifiedScreen />);
  await fireEvent.changeText(screen.getByLabelText('العنوان النهائي'), 'شرح كتاب التوحيد · الدرس السابع');
  await fireEvent.press(screen.getByText('نشر'));
  expect(screen.getByText('نشر المحاضرة؟')).toBeTruthy();
  expect(screen.getByText(/سيصل إشعار فوري إلى جميع الدارسين/)).toBeTruthy();
  expect(mockLive.save.mutate).not.toHaveBeenCalled();

  const confirm = screen.getAllByText('نشر');
  await fireEvent.press(confirm[confirm.length - 1]);
  expect(saved()).toEqual({
    lectureId: 'lec-1',
    title: 'شرح كتاب التوحيد · الدرس السابع',
    sheikhId: 'sh1',
    sectionId: null,
    publish: true,
    notify: true,
  });
});

test('«إشعار الطلاب» off → «نشر بدون إشعار»', async () => {
  await render(<UnclassifiedScreen />);
  await fireEvent(screen.getByLabelText('إشعار الطلاب'), 'valueChange', false);
  expect(screen.getByText('ستُضاف المحاضرة إلى القسم بهدوء — دون إشعار')).toBeTruthy();
  await fireEvent.press(screen.getByText('نشر بدون إشعار'));
  expect(screen.getByText(/ولن يصل أي إشعار للدارسين/)).toBeTruthy();
  const confirm = screen.getAllByText('نشر بدون إشعار');
  await fireEvent.press(confirm[confirm.length - 1]);
  expect(saved()).toMatchObject({ publish: true, notify: false });
});

test('«حفظ دون نشر» saves at once, without publishing', async () => {
  await render(<UnclassifiedScreen />);
  await fireEvent.press(screen.getByText('حفظ دون نشر'));
  expect(screen.queryByText('نشر المحاضرة؟')).toBeNull();
  expect(saved()).toMatchObject({ lectureId: 'lec-1', sheikhId: 'sh1', publish: false });
});

test('keyboard: Enter in the title = «نشر» (confirm opens)', async () => {
  await render(<UnclassifiedScreen />);
  await fireEvent(screen.getByLabelText('العنوان النهائي'), 'submitEditing');
  expect(screen.getByText('نشر المحاضرة؟')).toBeTruthy();
});

test('«تغيير» the section: the order stays automatic (end of the new section)', async () => {
  await render(<UnclassifiedScreen />);
  await fireEvent.press(screen.getByText('تغيير'));
  await fireEvent.press(screen.getByText('اختيار قسم آخر'));
  expect(screen.getByText('الترتيب تلقائي: في آخر القسم')).toBeTruthy();
  await fireEvent.press(screen.getByText('حفظ دون نشر'));
  expect(saved()).toMatchObject({ sectionId: 'sec-2', publish: false });
});

test('a too-short title or no sheikh blocks both actions', async () => {
  mockLive.inbox = { drafts: [{ ...draft, suggestedSheikhId: null, suggestedSheikhName: null }], pending: [] };
  await render(<UnclassifiedScreen />);
  expect(screen.getByText('اختر الشيخ...')).toBeTruthy();
  await fireEvent.press(screen.getByText('حفظ دون نشر'));
  await fireEvent.press(screen.getByText('نشر'));
  expect(screen.queryByText('نشر المحاضرة؟')).toBeNull();
  expect(mockLive.save.mutate).not.toHaveBeenCalled();

  // Pick the sheikh from the list → saving works.
  await fireEvent.press(screen.getByText('اختر الشيخ...'));
  await fireEvent.press(screen.getByText('الشيخ محمد'));
  await fireEvent.changeText(screen.getByLabelText('العنوان النهائي'), 'شر');
  expect(screen.getByText('العنوان من ٣ إلى ٢٠٠ حرف')).toBeTruthy();
  await fireEvent.press(screen.getByText('حفظ دون نشر'));
  expect(mockLive.save.mutate).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('العنوان النهائي'), 'شرح الأصول');
  await fireEvent.press(screen.getByText('حفظ دون نشر'));
  expect(saved()).toMatchObject({ title: 'شرح الأصول', sheikhId: 'sh2' });
});

test('a refused save shows the server\'s Arabic message on the card', async () => {
  mockLive.save.mutate.mockImplementation((_v: unknown, o: { onError: (e: unknown) => void }) =>
    o.onError({ message: 'أكمِل العنوان النهائي والشيخ قبل النشر' }),
  );
  await render(<UnclassifiedScreen />);
  await fireEvent.press(screen.getByText('حفظ دون نشر'));
  expect(screen.getByText('أكمِل العنوان النهائي والشيخ قبل النشر')).toBeTruthy();
});

test('a recording still being compressed: «جارٍ الضغط على الخادم»', async () => {
  mockLive.inbox = { drafts: [], pending: [compressing] };
  await render(<UnclassifiedScreen />);
  expect(screen.getByText('مجلس يُضغط الآن')).toBeTruthy();
  expect(screen.getByText('جارٍ الضغط على الخادم · ٤٢٪')).toBeTruthy();
  expect(screen.getByText('تسجيلات البث في طريقها إلى هنا')).toBeTruthy();
  expect(screen.queryByText('لا توجد محاضرات واردة')).toBeNull();
});

test('«فتح في الواردة» (?live=) puts that draft first', async () => {
  mockParams.current = { live: 'lec-2' };
  mockLive.inbox = {
    drafts: [draft, { ...draft, lectureId: 'lec-2', title: 'المجلس المطلوب', sessionTitle: 'المجلس المطلوب' }],
    pending: [],
  };
  await render(<UnclassifiedScreen />);
  const titles = screen.getAllByLabelText('العنوان النهائي').map((el) => el.props.value);
  expect(titles).toEqual(['المجلس المطلوب', 'شرح كتاب التوحيد']);
});
