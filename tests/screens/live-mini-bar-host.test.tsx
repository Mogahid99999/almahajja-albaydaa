/**
 * The live mini-bar's «×» for the host / a moderator (owner 2026-09-29:
 * «احاول انهاء البث ولا يقفل معي»). A host who pressed «×» used to leave
 * silently while the broadcast kept running; now «×» opens the room on
 * «مغادرة الحلقة» (hand over / «إنهاء البث للجميع»). Listeners still leave at
 * once, and after the end «×» only dismisses the bar.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockLeave = jest.fn(() => Promise.resolve());
const mockLive: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockLive);
  useLiveStore.getState = () => mockLive;
  return { useLiveStore };
});

import { LiveMiniBar } from '@/components/live/LiveMiniBar';

function setup(role: string, conn = 'ok') {
  for (const k of Object.keys(mockLive)) delete mockLive[k];
  Object.assign(mockLive, {
    session: { id: 's1', title: 'شرح كتاب التوحيد', sheikhName: 'الشيخ عبد الله' },
    conn,
    paused: false,
    people: {},
    activeSpeakers: [],
    me: { identity: 'me', role, hidden: false, gender: 'm' },
    setPaused: jest.fn(),
    leave: mockLeave,
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockLeave.mockClear();
});

test('the host: «×» opens the room on «مغادرة الحلقة» — never a silent leave', async () => {
  setup('host');
  await render(<LiveMiniBar />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(mockLeave).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/live/[id]', params: { id: 's1', end: '1' } });
});

test('a moderator: the same (hand over or end for all is chosen in the room)', async () => {
  setup('moderator');
  await render(<LiveMiniBar />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(mockLeave).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/live/[id]', params: { id: 's1', end: '1' } });
});

test('a listener leaves at once', async () => {
  setup('listener');
  await render(<LiveMiniBar />);
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});

test('after the end «انتهى المجلس», «×» just dismisses the bar — also for the host', async () => {
  setup('host', 'ended');
  await render(<LiveMiniBar />);
  expect(screen.getByText('انتهى المجلس')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});
