/**
 * MiniPlayer ⇄ LiveMiniBar (V23 §7.3): while a live «الحلقة» is joined the
 * global mini-player slot shows the live bar (a live owns the audio) — never
 * the lecture bar — and its × leaves the room. With no live and no lecture
 * the slot is empty.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/audioController', () => ({
  playNext: jest.fn(),
  stop: jest.fn(),
  toggle: jest.fn(),
}));

const mockPlayer: Record<string, unknown> = {};
jest.mock('@/stores/playerStore', () => ({
  usePlayerStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockPlayer),
}));

const mockLeave = jest.fn(() => Promise.resolve());
const mockLive: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockLive);
  useLiveStore.getState = () => mockLive;
  return { useLiveStore };
});

import { MiniPlayer } from '@/components/MiniPlayer';

const session = {
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
  Object.assign(mockPlayer, {
    currentLectureId: 'lec1',
    title: 'درس مسجّل',
    isPlaying: false,
    nextLectureId: null,
    positionSec: 0,
    durationSec: 100,
  });
  Object.assign(mockLive, {
    session: null,
    conn: 'idle',
    paused: false,
    people: {},
    activeSpeakers: [],
    setPaused: jest.fn(),
    leave: mockLeave,
  });
});

test('in a live: the slot shows «الحلقة · …», not the paused lecture, and × leaves', async () => {
  Object.assign(mockLive, { session, conn: 'ok' });
  await render(<MiniPlayer />);
  expect(screen.getByText('الحلقة · شرح كتاب التوحيد')).toBeTruthy();
  expect(screen.queryByText('درس مسجّل')).toBeNull();

  await fireEvent.press(screen.getByLabelText('مغادرة الحلقة'));
  expect(mockLeave).toHaveBeenCalledTimes(1);
});

test('reconnecting is said in the bar', async () => {
  Object.assign(mockLive, { session, conn: 'reconnecting' });
  await render(<MiniPlayer />);
  expect(screen.getByText('جارٍ إعادة الاتصال…')).toBeTruthy();
});

test('no live: the lecture bar as before; no live and no lecture: nothing', async () => {
  const { unmount } = await render(<MiniPlayer />);
  expect(screen.getByText('درس مسجّل')).toBeTruthy();
  await unmount();

  mockPlayer.currentLectureId = null;
  await render(<MiniPlayer />);
  expect(screen.queryByText('درس مسجّل')).toBeNull();
  expect(screen.queryByText(/الحلقة ·/)).toBeNull();
});
