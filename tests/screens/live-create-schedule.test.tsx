/**
 * CreateLiveSheet «متى يبدأ المجلس؟» (owner 2026-09-29: «الجدولة للبث لم اجدها»).
 *
 * Invariants:
 *  - «الآن» stays the default: create_live_session without a time → onCreated
 *    (the caller opens the green room);
 *  - «في موعد لاحق»: day chips + 12-hour time (15-minute steps, ص/م, Arabic
 *    digits); the RPC gets the chosen instant as ISO; success → onScheduled,
 *    never onCreated (so NO green room);
 *  - a time less than 10 minutes ahead is refused in Arabic and not sent.
 * Local-time Date constructors keep it timezone-agnostic.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

type MutateOpts = { onSuccess: (id: string) => void; onError: (e: unknown) => void };
const mockCreate = { mutate: jest.fn(), isPending: false };
jest.mock('@/hooks/useLive', () => ({
  useCreateLiveSession: () => mockCreate,
}));

// LiveHomeCard (useNow) reads the room store; nothing of it is used here.
jest.mock('@/stores/liveStore', () => ({ useLiveStore: () => null }));

import { CreateLiveSheet } from '@/components/live/sheets/CreateLiveSheet';

// Tuesday 29 September 2026, 14:07 local.
const NOW = new Date(2026, 8, 29, 14, 7);

const onCreated = jest.fn();
const onScheduled = jest.fn();
const onClose = jest.fn();

async function renderSheet() {
  await render(
    <CreateLiveSheet
      visible
      onClose={onClose}
      sectionId="sec-1"
      initialTitle="كتاب التوحيد"
      onCreated={onCreated}
      onScheduled={onScheduled}
    />,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockCreate.mutate = jest.fn();
  mockCreate.isPending = false;
});
afterEach(() => {
  jest.useRealTimers();
});

test('«الآن» is the default: no time is sent and the caller gets the green-room path', async () => {
  await renderSheet();
  expect(screen.getByText('متى يبدأ المجلس؟')).toBeTruthy();
  await fireEvent.press(screen.getByText('إلى غرفة التجهيز'));
  expect(mockCreate.mutate).toHaveBeenCalledWith(
    { sectionId: 'sec-1', title: 'كتاب التوحيد', notify: true, allowRequests: true },
    expect.any(Object),
  );
  const opts = mockCreate.mutate.mock.calls[0][1] as MutateOpts;
  await act(async () => opts.onSuccess('now-id'));
  expect(onCreated).toHaveBeenCalledWith('now-id');
  expect(onScheduled).not.toHaveBeenCalled();
});

test('«في موعد لاحق»: غداً ٨:٣٠ م → the RPC receives that ISO time, and no green room', async () => {
  await renderSheet();
  await fireEvent.press(screen.getByText('في موعد لاحق'));
  // The default: about an hour ahead on a quarter hour.
  expect(screen.getByText('الموعد: اليوم · ٣:١٥ م')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('غداً ٣٠ سبتمبر'));
  await fireEvent.press(screen.getByLabelText('الساعة ٨'));
  await fireEvent.press(screen.getByLabelText('الدقيقة ٣٠'));
  await fireEvent.press(screen.getByLabelText('مساءً'));
  expect(screen.getByText('الموعد: غداً · ٨:٣٠ م')).toBeTruthy();

  await fireEvent.press(screen.getByText('جدولة المجلس'));
  const iso = new Date(2026, 8, 30, 20, 30).toISOString();
  expect(mockCreate.mutate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mutate.mock.calls[0][0]).toEqual({
    sectionId: 'sec-1',
    title: 'كتاب التوحيد',
    notify: true,
    allowRequests: true,
    scheduledAt: iso,
  });
  const opts = mockCreate.mutate.mock.calls[0][1] as MutateOpts;
  await act(async () => opts.onSuccess('sched-id'));
  expect(onScheduled).toHaveBeenCalledWith('sched-id', iso);
  expect(onCreated).not.toHaveBeenCalled();
});

test('less than 10 minutes ahead: an Arabic line, and nothing is sent', async () => {
  await renderSheet();
  await fireEvent.press(screen.getByText('في موعد لاحق'));
  await fireEvent.press(screen.getByLabelText('اليوم ٢٩ سبتمبر'));
  await fireEvent.press(screen.getByLabelText('الساعة ٢'));
  await fireEvent.press(screen.getByLabelText('الدقيقة ١٥')); // 14:15 — 8 minutes from 14:07
  await fireEvent.press(screen.getByLabelText('مساءً'));
  expect(screen.getByText('اختر موعداً بعد عشر دقائق من الآن على الأقل')).toBeTruthy();
  await fireEvent.press(screen.getByText('جدولة المجلس'));
  expect(mockCreate.mutate).not.toHaveBeenCalled();

  // An earlier hour today is refused too; 14:30 is fine.
  await fireEvent.press(screen.getByLabelText('الدقيقة ٣٠'));
  expect(screen.queryByText('اختر موعداً بعد عشر دقائق من الآن على الأقل')).toBeNull();
  expect(screen.getByText('الموعد: اليوم · ٢:٣٠ م')).toBeTruthy();
});

test('the server refusing shows its Arabic message', async () => {
  await renderSheet();
  await fireEvent.press(screen.getByText('في موعد لاحق'));
  await fireEvent.press(screen.getByText('جدولة المجلس'));
  const opts = mockCreate.mutate.mock.calls[0][1] as MutateOpts;
  await act(async () => opts.onError({ message: 'موعد المجلس يجب أن يكون في المستقبل' }));
  expect(screen.getByText('موعد المجلس يجب أن يكون في المستقبل')).toBeTruthy();
  expect(onScheduled).not.toHaveBeenCalled();
});
