/**
 * app/live/green/[id].tsx — the host's green room (V23 P4, PLAN_LIVE_V23 §7.6).
 *
 * Invariants: openGreen(session) runs ONCE for a scheduled/green session; the
 * page says where the recording goes («يُسجَّل تلقائياً ويُحفظ في قسم …») and
 * «إشعار للجميع عند البدء»; «ابدأ البث» waits for a working connection, then
 * startBroadcast() → router.replace to the room (the green connection is
 * handed on, never left); a refusal shows in Arabic and stays; «إلغاء» cancels
 * the session, leaves and closes; closing any other way leaves (no hot mic
 * behind another screen); an already-live session goes straight to the room.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCollapse = jest.fn();
jest.mock('@/components/live/LivePeekSheet', () => ({
  LivePeekSheet: ({ children }: { children: (c: () => void) => unknown }) => children(mockCollapse),
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 's1' }),
  useRouter: () => mockRouter,
}));

const mockSession: { current: Record<string, unknown> | null } = { current: null };
const mockCancel = { mutate: jest.fn(), isPending: false };
const mockCreate = { mutate: jest.fn(), isPending: false };
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession.current, isLoading: false, refetch: jest.fn() }),
  useLiveStaffParticipants: () => ({ data: [] }),
  useCancelLiveSession: () => mockCancel,
  useCreateLiveSession: () => mockCreate,
}));

const mockState: Record<string, unknown> = {};
const mockMicLevel = jest.fn(() => 0.5);
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore, getLiveMicLevel: () => mockMicLevel() };
});

import { LiveControlError } from '@/api/live';
import { CreateLiveSheet } from '@/components/live/sheets/CreateLiveSheet';
import GreenRoomScreen from '../../app/live/green/[id]';

const green = {
  id: 's1',
  sectionId: 'sec1',
  sectionTitle: 'العقيدة',
  sheikhId: 'sh1',
  sheikhName: 'الشيخ عبد الله',
  title: 'شرح كتاب التوحيد',
  status: 'green',
  scheduledAt: null,
  startedAt: null,
  endedAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
};

/** The store after openGreen (mutating the mock store doesn't re-render, so tests start here). */
function connected(conn = 'ok') {
  Object.assign(mockState, {
    session: green,
    conn,
    me: { identity: 'host-id', role: 'host', hidden: false, gender: 'm' },
  });
}

beforeEach(() => {
  mockCollapse.mockReset();
  mockRouter.replace.mockReset();
  mockCancel.mutate.mockReset();
  mockMicLevel.mockClear();
  mockSession.current = green;
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    session: null,
    conn: 'idle',
    me: null,
    people: {},
    openGreen: jest.fn(async (s: unknown) => {
      Object.assign(mockState, {
        session: s,
        conn: 'ok',
        me: { identity: 'host-id', role: 'host', hidden: false, gender: 'm' },
      });
    }),
    startBroadcast: jest.fn(() => Promise.resolve()),
    leave: jest.fn(() => Promise.resolve()),
  });
});

test('opens the green room once and says where the recording goes', async () => {
  const { rerender } = await render(<GreenRoomScreen />);
  expect(mockState.openGreen).toHaveBeenCalledTimes(1);
  expect(mockState.openGreen).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  expect(screen.getByText('يُسجَّل تلقائياً ويُحفظ في قسم العقيدة')).toBeTruthy();
  expect(screen.getByText('إشعار للجميع عند البدء')).toBeTruthy();
  await rerender(<GreenRoomScreen />);
  expect(mockState.openGreen).toHaveBeenCalledTimes(1);
});

test('the mic meter polls the store level while connected', async () => {
  jest.useFakeTimers();
  try {
    Object.assign(mockState, { session: green, conn: 'ok' });
    await render(<GreenRoomScreen />);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockMicLevel.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByLabelText('يصل صوتك إلى الميكروفون')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('«ابدأ البث» → startBroadcast → replace to the room, without leaving', async () => {
  connected();
  const { unmount } = await render(<GreenRoomScreen />);
  await fireEvent.press(screen.getByText('ابدأ البث'));
  await act(async () => {});
  expect(mockState.startBroadcast).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).toHaveBeenCalledWith('/live/s1');
  await act(async () => {
    await unmount();
  });
  expect(mockState.leave).not.toHaveBeenCalled(); // the room takes the connection over
});

test('«ابدأ البث» waits for a working connection', async () => {
  connected('connecting');
  await render(<GreenRoomScreen />);
  expect(screen.getByText('جارٍ تجهيز الاتصال…')).toBeTruthy();
  await fireEvent.press(screen.getByText('ابدأ البث'));
  expect(mockState.startBroadcast).not.toHaveBeenCalled();
});

test('a refused start shows the reason in Arabic and stays', async () => {
  (mockState.startBroadcast as jest.Mock).mockRejectedValue(new LiveControlError('another_live_active'));
  connected();
  await render(<GreenRoomScreen />);
  await fireEvent.press(screen.getByText('ابدأ البث'));
  await act(async () => {});
  expect(screen.getByText('يوجد بث مباشر قائم الآن، ولا يُفتح بثّان معاً')).toBeTruthy();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('«إلغاء» cancels the session, leaves and closes', async () => {
  mockCancel.mutate.mockImplementation((_id: string, o?: { onSuccess?: () => void }) => o?.onSuccess?.());
  connected();
  await render(<GreenRoomScreen />);
  await fireEvent.press(screen.getByLabelText('إلغاء المجلس'));
  expect(mockCancel.mutate).toHaveBeenCalledWith('s1', expect.anything());
  expect(mockState.leave).toHaveBeenCalledTimes(1);
  expect(mockCollapse).toHaveBeenCalled();
});

test('closing without starting leaves the green connection (no hot mic)', async () => {
  connected();
  const { unmount } = await render(<GreenRoomScreen />);
  await act(async () => {
    await unmount();
  });
  expect(mockState.leave).toHaveBeenCalledTimes(1);
});

test('a session that is already live goes straight to the room', async () => {
  mockSession.current = { ...green, status: 'live' };
  await render(<GreenRoomScreen />);
  expect(mockRouter.replace).toHaveBeenCalledWith('/live/s1');
  expect(mockState.openGreen).not.toHaveBeenCalled();
});

test('a cancelled session says so and never opens', async () => {
  mockSession.current = { ...green, status: 'cancelled' };
  await render(<GreenRoomScreen />);
  expect(screen.getByText('أُلغي المجلس')).toBeTruthy();
  expect(mockState.openGreen).not.toHaveBeenCalled();
});

// ─── Section page «ابدأ مجلساً مباشراً» → CreateLiveSheet ─────────────────────

test('CreateLiveSheet: the section title is prefilled; both switches start on; created → green room', async () => {
  mockCreate.mutate.mockReset();
  mockCreate.mutate.mockImplementation((_v: unknown, o?: { onSuccess?: (id: string) => void }) =>
    o?.onSuccess?.('new-id'),
  );
  const onCreated = jest.fn();
  await render(
    <CreateLiveSheet visible onClose={jest.fn()} sectionId="sec1" initialTitle="كتاب التوحيد" onCreated={onCreated} />,
  );
  expect(screen.getByDisplayValue('كتاب التوحيد')).toBeTruthy();
  await fireEvent.press(screen.getByText('إلى غرفة التجهيز'));
  expect(mockCreate.mutate).toHaveBeenCalledWith(
    { sectionId: 'sec1', title: 'كتاب التوحيد', notify: true, allowRequests: true },
    expect.anything(),
  );
  expect(onCreated).toHaveBeenCalledWith('new-id');
});

test('CreateLiveSheet: a too-short title cannot be sent; the RPC Arabic error is shown as is', async () => {
  mockCreate.mutate.mockReset();
  mockCreate.mutate.mockImplementation((_v: unknown, o?: { onError?: (e: unknown) => void }) =>
    o?.onError?.({ message: 'يوجد بث مباشر قائم الآن' }),
  );
  await render(
    <CreateLiveSheet visible onClose={jest.fn()} sectionId="sec1" initialTitle="أب" onCreated={jest.fn()} />,
  );
  expect(screen.getByText('العنوان من ٣ إلى ٢٠٠ حرف')).toBeTruthy();
  await fireEvent.press(screen.getByText('إلى غرفة التجهيز'));
  expect(mockCreate.mutate).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('عنوان المجلس'), 'درس السبت');
  await fireEvent.press(screen.getByText('إلى غرفة التجهيز'));
  expect(screen.getByText('يوجد بث مباشر قائم الآن')).toBeTruthy();
});
