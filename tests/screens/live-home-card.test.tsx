/**
 * LiveHomeCard — the «مباشر الآن» card in Home's ContinueCard slot
 * (V23 §7.3, §15 home.card). Asserts the exact Arabic copy, the «استمع» →
 * «العودة إلى الحلقة» switch once this session is joined (with the live
 * attendance and «الشيخ يتحدث» from the room), and that a tap opens the room.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { LiveHomeCard } from '@/components/live/LiveHomeCard';
import type { LiveSessionPublic } from '@/api/live';

const session: LiveSessionPublic = {
  id: 's1',
  sectionId: 'sec1',
  sectionTitle: 'العقيدة',
  sheikhId: 'sh1',
  sheikhName: 'الشيخ عبد الله',
  title: 'شرح كتاب التوحيد',
  status: 'live',
  scheduledAt: null,
  startedAt: '2026-09-28T18:00:00Z',
  endedAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-28T18:42:30Z'));
  Object.assign(mockState, {
    session: null,
    people: {},
    activeSpeakers: [],
    counts: { brothers: 0, sisters: 0 },
    paused: false,
  });
});
afterEach(() => {
  jest.useRealTimers();
});

test('not joined: «مباشر الآن», minutes since start, «استمع», and a tap opens the room', async () => {
  await render(<LiveHomeCard session={session} />);
  expect(screen.getByText('مباشر الآن')).toBeTruthy();
  expect(screen.getByText('بدأ منذ ٤٢ دقيقة')).toBeTruthy();
  expect(screen.getByText('شرح كتاب التوحيد')).toBeTruthy();
  expect(screen.getByText('استمع')).toBeTruthy();
  expect(screen.queryByText('الشيخ يتحدث')).toBeNull();

  await fireEvent.press(screen.getByText('شرح كتاب التوحيد'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/live/[id]', params: { id: 's1' } });
});

test('joined: «العودة إلى الحلقة», the room attendance and «الشيخ يتحدث»', async () => {
  Object.assign(mockState, {
    session,
    people: { h1: { identity: 'h1', role: 'host', gender: 'm', name: 'الشيخ', hidden: false, hand: false, speaking: true, isMe: false } },
    activeSpeakers: ['h1'],
    counts: { brothers: 120, sisters: 80 },
  });
  await render(<LiveHomeCard session={session} />);
  expect(screen.getByText('العودة إلى الحلقة')).toBeTruthy();
  expect(screen.getByText('٢٠٠ في الحلقة')).toBeTruthy();
  expect(screen.getByText('الشيخ يتحدث')).toBeTruthy();
});
