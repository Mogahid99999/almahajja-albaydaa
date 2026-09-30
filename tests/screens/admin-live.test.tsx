/**
 * app/admin/live.tsx — the staff «البث المباشر» screen (V23 P6, §8; D7).
 *
 * Invariants:
 *  - D7 (owner 2026-09-29): on the PHONE a staff member picks a section →
 *    CreateLiveSheet → the new session's green room; on WEB there is no start
 *    button, only «يبدأ البث من تطبيق الهاتف» (and the room opens only on the
 *    phone: «تُفتح الحلقة من تطبيق الهاتف»);
 *  - live now shows title, sheikh, section and attendees; «فتح الحلقة» → the room;
 *  - a recording being compressed shows «جارٍ الضغط على الخادم · ٤٢٪»;
 *  - failed → «إعادة المعالجة» (retry_live_recording); ready + needs title →
 *    «فتح في الواردة» with that lecture; «تنزيل التسجيل الأصلي»;
 *  - a sheikh (not a content manager) gets none of those manager actions;
 *  - «إلغاء المجلس» asks first, then cancel_live_session;
 *  - scheduling (owner 2026-09-29): a session scheduled from the sheet does NOT
 *    open the green room — the lists refresh and «جُدول المجلس: …» confirms;
 *  - «إنهاء البث للجميع» (owner: «احاول انهاء البث ولا يقفل معي»): a live card
 *    offers it to its host / a content manager, on the phone AND the web; it
 *    asks first (naming the section), then live-control `end`; a refusal stays
 *    on the card in Arabic.
 *  - «التعليقات والأسئلة» (0147) stay with a majlis that went on air: one line
 *    per card, read only when opened, deleted ones marked «حُذف».
 */
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { scheduledConfirmLine } from '@/components/live/liveSchedule';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
// The real SectionPicker (own test) reads the sections tree; one button picks «sec-1».
jest.mock('@/components/admin/live/SectionPickerSheet', () => {
  const { Pressable, Text } = require('react-native');
  return {
    SectionPicker: ({ onChange }: { onChange: (id: string) => void }) => (
      <Pressable onPress={() => onChange('sec-1')}>
        <Text>اختيار قسم تجربة</Text>
      </Pressable>
    ),
  };
});
// CreateLiveSheet is P4's (own tests); here it only has to hand back an id.
jest.mock('@/components/live/sheets/CreateLiveSheet', () => {
  const { Pressable, Text } = require('react-native');
  return {
    CreateLiveSheet: ({
      visible,
      sectionId,
      initialTitle,
      onCreated,
      onScheduled,
    }: {
      visible: boolean;
      sectionId: string;
      initialTitle: string;
      onCreated: (id: string) => void;
      onScheduled?: (id: string, at: string) => void;
    }) =>
      visible ? (
        <>
          <Pressable onPress={() => onCreated('new-session')}>
            <Text>{`ورقة الإنشاء ${sectionId} ${initialTitle}`}</Text>
          </Pressable>
          <Pressable onPress={() => onScheduled?.('sched-session', mockScheduledAt)}>
            <Text>جدولة من الورقة</Text>
          </Pressable>
        </>
      ) : null,
  };
});
const mockScheduledAt = new Date(2026, 8, 30, 20, 30).toISOString();
jest.mock('@/hooks/useSections', () => ({
  useSectionsFlat: () => ({
    data: [{ id: 'sec-1', title: 'كتاب التوحيد', parentId: null, depth: 0, path: ['كتاب التوحيد'], order: 1 }],
  }),
}));

const mockUser: { current: Record<string, unknown> } = { current: { role: 'admin', isGuest: false } };
jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockUser.current }),
}));

type Mutation = { mutate: jest.Mock; isPending: boolean; variables?: unknown };
const mk = (): Mutation => ({ mutate: jest.fn(), isPending: false });
const mockLive = {
  overview: null as unknown,
  cancel: mk(),
  retry: mk(),
  download: mk(),
  end: mk(),
  refresh: jest.fn(),
  /** admin_live_comments per session (0147); the ids it was asked for. */
  comments: [] as unknown[],
  commentsAsked: [] as string[],
};
jest.mock('@/components/admin/live/useEndLiveSession', () => ({
  useEndLiveSession: () => mockLive.end,
}));
jest.mock('@/hooks/useLiveAdmin', () => ({
  useLiveAdminOverview: () => ({
    data: mockLive.overview,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useCancelLiveAdminSession: () => mockLive.cancel,
  useRetryLiveRecording: () => mockLive.retry,
  useDownloadRawRecording: () => mockLive.download,
  useRefreshLiveAdmin: () => mockLive.refresh,
  useAdminLiveComments: (id: string) => {
    mockLive.commentsAsked.push(id);
    return { data: mockLive.comments, isLoading: false, isError: false };
  },
}));

import AdminLiveScreen from '../../app/admin/live';

const NOW = Date.parse('2026-09-29T18:30:00Z');

function session(over: Record<string, unknown>) {
  return {
    id: 's',
    title: 'مجلس',
    status: 'ended',
    sectionId: 'sec-1',
    sectionTitle: 'كتاب التوحيد',
    sheikhId: 'sh1',
    sheikhName: 'الشيخ عبد الله',
    hostUserId: 'u-admin',
    hostName: 'المدير',
    isMine: false,
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    createdAt: null,
    shareCode: 'ABC234',
    peakListeners: 0,
    attendees: 0,
    lectureId: null,
    lectureStatus: null,
    lectureNeedsTitle: false,
    durationSec: null,
    rawLocal: false,
    rawBackup: false,
    job: null,
    ...over,
  };
}

const liveNow = session({
  id: 's-live',
  title: 'شرح كتاب التوحيد · الدرس السابع',
  status: 'live',
  startedAt: '2026-09-29T18:00:00Z',
  attendees: 12,
});
const processing = session({
  id: 's-proc',
  title: 'مجلس يُضغط',
  status: 'processing',
  endedAt: '2026-09-29T17:00:00Z',
  rawLocal: true,
  job: { id: 'j1', status: 'running', progress: 0.42, attempts: 1, error: null },
});
const failed = session({
  id: 's-failed',
  title: 'مجلس تعذّر',
  status: 'failed',
  endedAt: '2026-09-29T16:00:00Z',
  rawLocal: true,
  job: { id: 'j2', status: 'failed', progress: 0.1, attempts: 3, error: 'ffmpeg exited 1' },
});
const ready = session({
  id: 's-ready',
  title: 'مجلس جاهز',
  status: 'ready',
  endedAt: '2026-09-29T15:00:00Z',
  lectureId: 'lec-1',
  lectureStatus: 'draft',
  lectureNeedsTitle: true,
  durationSec: 3252,
  rawBackup: true,
  peakListeners: 42,
});
const scheduled = session({
  id: 's-sched',
  title: 'مجلس مجدول',
  status: 'scheduled',
  scheduledAt: '2026-09-30T17:00:00Z',
  isMine: true,
});

const realOS = Platform.OS;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  (Platform as { OS: string }).OS = 'android';
  mockUser.current = { role: 'admin', isGuest: false };
  mockRouter.push.mockReset();
  mockLive.cancel = mk();
  mockLive.retry = mk();
  mockLive.download = mk();
  mockLive.end = mk();
  mockLive.refresh = jest.fn();
  mockLive.comments = [];
  mockLive.commentsAsked = [];
  mockLive.overview = {
    active: [liveNow],
    scheduled: [scheduled],
    recent: [processing, failed, ready],
    isManager: true,
  };
});
afterEach(() => {
  jest.useRealTimers();
  (Platform as { OS: string }).OS = realOS;
});

test('live now: title, sheikh, section, attendees; «فتح الحلقة» opens the room', async () => {
  await render(<AdminLiveScreen />);
  expect(screen.getByText('شرح كتاب التوحيد · الدرس السابع')).toBeTruthy();
  expect(screen.getAllByText('مباشر الآن').length).toBeGreaterThan(0);
  expect(screen.getByText(/بدأ منذ ٣٠ دقيقة · ١٢ في الحلقة/)).toBeTruthy();
  expect(screen.getAllByText('الشيخ عبد الله').length).toBeGreaterThan(0);

  await fireEvent.press(screen.getByText('فتح الحلقة'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/live/[id]', params: { id: 's-live' } });
});

test('D7 on the phone: section → CreateLiveSheet → the new green room', async () => {
  await render(<AdminLiveScreen />);
  // The start button waits for a section.
  await fireEvent.press(screen.getAllByText('ابدأ مجلساً مباشراً')[1]);
  expect(screen.queryByText(/ورقة الإنشاء/)).toBeNull();

  await fireEvent.press(screen.getByText('اختيار قسم تجربة'));
  await fireEvent.press(screen.getAllByText('ابدأ مجلساً مباشراً')[1]);
  // The sheet gets the section and its title as the preliminary title.
  await fireEvent.press(screen.getByText('ورقة الإنشاء sec-1 كتاب التوحيد'));
  expect(mockLive.refresh).toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/live/green/[id]', params: { id: 'new-session' } });
});

test('«التعليقات والأسئلة» stay with the majlis: loaded when opened, deleted ones marked, nameless stays nameless', async () => {
  mockLive.overview = { active: [], scheduled: [scheduled], recent: [ready], isManager: true };
  mockLive.comments = [
    { id: 'c1', kind: 'comment', text: 'بارك الله فيكم', name: 'خالد', gender: 'm', answered: false, at: '2026-09-29T15:10:00.000Z' },
    { id: 'c2', kind: 'question', text: 'ما حكم المسألة؟', name: null, gender: 'f', answered: true, at: '2026-09-29T15:12:00.000Z' },
    { id: 'c3', kind: 'comment', text: 'كلام محذوف', name: null, gender: 'm', answered: false, at: '2026-09-29T15:13:00.000Z', deleted: true },
  ];
  await render(<AdminLiveScreen />);
  // Only the session that went on air has the list — and nothing is read until it is opened.
  expect(screen.getAllByText('التعليقات والأسئلة')).toHaveLength(1);
  expect(mockLive.commentsAsked).toHaveLength(0);

  await fireEvent.press(screen.getByText('التعليقات والأسئلة'));
  expect(mockLive.commentsAsked).toContain('s-ready');
  expect(screen.getByText('التعليقات والأسئلة (٣)')).toBeTruthy();
  expect(screen.getByText('بارك الله فيكم')).toBeTruthy();
  expect(screen.getByText('طالبة')).toBeTruthy();
  expect(screen.getByText('طالب')).toBeTruthy();
  // No «سؤال» / «تمت الإجابة» marks in the UI (owner 2026-09-30).
  expect(screen.queryByText(/تمت الإجابة/)).toBeNull();
  expect(screen.getByText(/حُذف/)).toBeTruthy();
  expect(screen.getByText('كلام محذوف')).toBeTruthy();
});

test('D3: while a session holds the slot, the start card says so up front', async () => {
  await render(<AdminLiveScreen />);
  expect(
    screen.getByText('يوجد بث مباشر قائم الآن، ولا يُفتح بثّان معاً: «شرح كتاب التوحيد · الدرس السابع»'),
  ).toBeTruthy();
});

test('D7 on the web: no start button and no room button — the phone line instead', async () => {
  (Platform as { OS: string }).OS = 'web';
  await render(<AdminLiveScreen />);
  expect(screen.getAllByText('يبدأ البث من تطبيق الهاتف').length).toBeGreaterThan(0);
  expect(screen.getByText('تُفتح الحلقة من تطبيق الهاتف')).toBeTruthy();
  expect(screen.queryByText('اختيار قسم تجربة')).toBeNull();
  expect(screen.queryByText('فتح الحلقة')).toBeNull();
  expect(screen.queryByText('فتح غرفة التجهيز')).toBeNull();
});

test('a recording being compressed shows «جارٍ الضغط على الخادم» with its progress', async () => {
  await render(<AdminLiveScreen />);
  expect(screen.getByText('جارٍ الضغط على الخادم · ٤٢٪')).toBeTruthy();
});

test('failed → «إعادة المعالجة»; the raw is kept and downloadable', async () => {
  await render(<AdminLiveScreen />);
  expect(screen.getByText('تعذّرت معالجة التسجيل')).toBeTruthy();
  expect(screen.getByText('التسجيل الأصلي محفوظ · ffmpeg exited 1')).toBeTruthy();

  await fireEvent.press(screen.getByText('إعادة المعالجة'));
  expect(mockLive.retry.mutate).toHaveBeenCalledWith('s-failed', expect.any(Object));
});

test('ready + needs title → «فتح في الواردة» with that lecture', async () => {
  await render(<AdminLiveScreen />);
  expect(screen.getByText('جاهز · بانتظار العنوان والشيخ')).toBeTruthy();
  await fireEvent.press(screen.getByText('فتح في الواردة'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/admin/unclassified', params: { live: 'lec-1' } });
});

test('«تنزيل التسجيل الأصلي» asks the worker for that session; a failure stays on the card in Arabic', async () => {
  await render(<AdminLiveScreen />);
  const buttons = screen.getAllByText('تنزيل التسجيل الأصلي');
  expect(buttons).toHaveLength(3); // processing (local raw), failed (local raw), ready (R2 backup)
  mockLive.download.mutate.mockImplementation((_v: unknown, o: { onError: (e: unknown) => void }) =>
    o.onError(new Error('لا تملك صلاحية تنزيل التسجيل الأصلي')),
  );
  await fireEvent.press(buttons[2]);
  expect(mockLive.download.mutate).toHaveBeenCalledWith(
    { sessionId: 's-ready', title: 'مجلس جاهز' },
    expect.any(Object),
  );
  expect(screen.getByText('لا تملك صلاحية تنزيل التسجيل الأصلي')).toBeTruthy();
});

test('a sheikh sees his sessions without the content-manager actions', async () => {
  mockUser.current = { role: 'sheikh', isGuest: false };
  mockLive.overview = { active: [], scheduled: [scheduled], recent: [failed, ready], isManager: false };
  await render(<AdminLiveScreen />);
  expect(screen.getByText('لا يوجد بث مباشر الآن')).toBeTruthy();
  expect(screen.queryByText('إعادة المعالجة')).toBeNull();
  expect(screen.queryByText('فتح في الواردة')).toBeNull();
  expect(screen.queryByText('تنزيل التسجيل الأصلي')).toBeNull();
  // …but he can open and cancel the session he hosts.
  expect(screen.getByText('فتح غرفة التجهيز')).toBeTruthy();
  expect(screen.getByText('إلغاء المجلس')).toBeTruthy();
});

test('«إلغاء المجلس» asks first, then cancel_live_session', async () => {
  await render(<AdminLiveScreen />);
  await fireEvent.press(screen.getByText('إلغاء المجلس'));
  expect(screen.getByText('إلغاء المجلس؟')).toBeTruthy();
  expect(mockLive.cancel.mutate).not.toHaveBeenCalled();
  const confirm = screen.getAllByText('إلغاء المجلس');
  await fireEvent.press(confirm[confirm.length - 1]);
  expect(mockLive.cancel.mutate).toHaveBeenCalledWith('s-sched', expect.any(Object));
});

test('the host opens his scheduled session\'s green room on the phone', async () => {
  await render(<AdminLiveScreen />);
  await fireEvent.press(screen.getByText('فتح غرفة التجهيز'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/live/green/[id]', params: { id: 's-sched' } });
});

test('scheduling from the sheet: no green room — the lists refresh and «جُدول المجلس: …» confirms', async () => {
  await render(<AdminLiveScreen />);
  await fireEvent.press(screen.getByText('اختيار قسم تجربة'));
  await fireEvent.press(screen.getAllByText('ابدأ مجلساً مباشراً')[1]);
  await fireEvent.press(screen.getByText('جدولة من الورقة'));

  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockLive.refresh).toHaveBeenCalled();
  const line = scheduledConfirmLine(mockScheduledAt, Date.now());
  expect(line).toMatch(/^جُدول المجلس: (اليوم|غداً) [٠-٩]+:[٠-٩]+ م، ويصل الطلاب تذكير قبل بدئه$/);
  expect(screen.getByText(line)).toBeTruthy();
  // The sheet closed.
  expect(screen.queryByText('جدولة من الورقة')).toBeNull();
});

describe('«إنهاء البث للجميع» on the live card', () => {
  test('a content manager: asks first (naming the section), then live-control end for that session', async () => {
    await render(<AdminLiveScreen />);
    await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
    expect(screen.getByText('إنهاء البث للجميع؟')).toBeTruthy();
    expect(
      screen.getByText('ينتهي «شرح كتاب التوحيد · الدرس السابع» عند جميع الحاضرين، ويُحفظ التسجيل في قسم كتاب التوحيد.'),
    ).toBeTruthy();
    expect(mockLive.end.mutate).not.toHaveBeenCalled();

    const confirm = screen.getAllByText('إنهاء البث للجميع');
    await fireEvent.press(confirm[confirm.length - 1]);
    expect(mockLive.end.mutate).toHaveBeenCalledTimes(1);
    expect(mockLive.end.mutate).toHaveBeenCalledWith('s-live', expect.any(Object));
  });

  test('on the web too — an admin can close a forgotten live from the browser', async () => {
    (Platform as { OS: string }).OS = 'web';
    await render(<AdminLiveScreen />);
    expect(screen.queryByText('فتح الحلقة')).toBeNull();
    await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
    const confirm = screen.getAllByText('إنهاء البث للجميع');
    await fireEvent.press(confirm[confirm.length - 1]);
    expect(mockLive.end.mutate).toHaveBeenCalledWith('s-live', expect.any(Object));
  });

  test('a refusal stays on the card in Arabic', async () => {
    const { LiveControlError } = require('@/api/live');
    mockLive.end.mutate.mockImplementation((_id: unknown, o: { onError: (e: unknown) => void; onSettled: () => void }) => {
      o.onError(new LiveControlError('forbidden'));
      o.onSettled();
    });
    await render(<AdminLiveScreen />);
    await fireEvent.press(screen.getByText('إنهاء البث للجميع'));
    const confirm = screen.getAllByText('إنهاء البث للجميع');
    await fireEvent.press(confirm[confirm.length - 1]);
    expect(screen.getByText('لا تملك صلاحية هذا الإجراء')).toBeTruthy();
    expect(screen.queryByText('إنهاء البث للجميع؟')).toBeNull();
  });

  test('busy while the end runs', async () => {
    mockLive.end = { mutate: jest.fn(), isPending: true, variables: 's-live' };
    await render(<AdminLiveScreen />);
    expect(screen.getByText('جارٍ إنهاء البث…')).toBeTruthy();
  });

  test('a sheikh who is not its host gets no end button; the host does', async () => {
    mockUser.current = { role: 'sheikh', isGuest: false };
    mockLive.overview = { active: [liveNow], scheduled: [], recent: [], isManager: false };
    const { unmount } = await render(<AdminLiveScreen />);
    expect(screen.queryByText('إنهاء البث للجميع')).toBeNull();
    await unmount();

    mockLive.overview = { active: [{ ...liveNow, isMine: true }], scheduled: [], recent: [], isManager: false };
    await render(<AdminLiveScreen />);
    expect(screen.getByText('إنهاء البث للجميع')).toBeTruthy();
  });
});
