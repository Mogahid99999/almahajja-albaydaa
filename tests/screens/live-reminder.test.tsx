/**
 * LiveUpcomingCard «ذكّرني» (V23 P5, §9.4 — set_live_reminder, migration 0142).
 *
 * Pins: a registered student taps «ذكّرني» → the row says «سنذكّرك» at once
 * (optimistic) and the reminder RPC runs; a refusal flips it back with a calm
 * Arabic line; tapping «سنذكّرك» cancels; guests get no button (the server
 * refuses them anyway).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockUser: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockUser.current }),
}));

type MutateOpts = { onError?: (e: unknown) => void };
const mockMutate = jest.fn<void, [{ sessionId: string; on: boolean }, MutateOpts?]>();
jest.mock('@/hooks/useLive', () => ({
  useSetLiveReminder: () => ({ mutate: mockMutate, isPending: false }),
}));

// LiveHomeCard (useNow) reads the room store; LiveKit is not needed here.
jest.mock('@/stores/liveStore', () => ({ useLiveStore: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import type { LiveSessionPublic } from '@/api/live';
import { LiveUpcomingCard } from '@/components/live/LiveUpcomingCard';

const upcoming: LiveSessionPublic = {
  id: 'u1',
  sectionId: 'sec1',
  sectionTitle: 'العقيدة',
  sheikhId: 'sh1',
  sheikhName: 'الشيخ عبد الله',
  title: 'شرح الأصول الثلاثة',
  status: 'scheduled',
  scheduledAt: '2026-09-29T17:30:00Z',
  startedAt: null,
  endedAt: null,
  shareCode: 'XYZ789',
  peakListeners: 0,
};
const sessions = [upcoming];
const NONE: string[] = [];
const REMINDED = ['u1'];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  mockMutate.mockReset();
  mockUser.current = { id: 'me', role: 'student', isGuest: false, gender: 'male' };
});
afterEach(() => {
  jest.useRealTimers();
});

test('«ذكّرني» flips to «سنذكّرك» at once and sets the reminder', async () => {
  await render(<LiveUpcomingCard sessions={sessions} remindedIds={NONE} />);
  expect(screen.getByText('المجلس المباشر القادم')).toBeTruthy();
  expect(screen.getByText('شرح الأصول الثلاثة')).toBeTruthy();

  await fireEvent.press(screen.getByText('ذكّرني'));
  expect(mockMutate).toHaveBeenCalledWith({ sessionId: 'u1', on: true }, expect.any(Object));
  expect(screen.getByText('سنذكّرك')).toBeTruthy();
  expect(screen.queryByText('ذكّرني')).toBeNull();
});

test('a refused reminder flips back and says so calmly', async () => {
  mockMutate.mockImplementation((_v, opts) => opts?.onError?.({ message: 'لا يمكن التذكير بهذا المجلس' }));
  await render(<LiveUpcomingCard sessions={sessions} remindedIds={NONE} />);
  await fireEvent.press(screen.getByText('ذكّرني'));
  expect(screen.getByText('ذكّرني')).toBeTruthy();
  expect(screen.getByText('لا يمكن التذكير بهذا المجلس')).toBeTruthy();
});

test('a network failure gets the generic Arabic line (no English leaks)', async () => {
  mockMutate.mockImplementation((_v, opts) => opts?.onError?.(new Error('Failed to fetch')));
  await render(<LiveUpcomingCard sessions={sessions} remindedIds={NONE} />);
  await fireEvent.press(screen.getByText('ذكّرني'));
  expect(screen.getByText('تعذّر حفظ التذكير. حاول مرة أخرى')).toBeTruthy();
  expect(screen.queryByText('Failed to fetch')).toBeNull();
});

test('tapping «سنذكّرك» cancels the reminder', async () => {
  await render(<LiveUpcomingCard sessions={sessions} remindedIds={REMINDED} />);
  await fireEvent.press(screen.getByLabelText('إلغاء التذكير'));
  expect(mockMutate).toHaveBeenCalledWith({ sessionId: 'u1', on: false }, expect.any(Object));
  expect(screen.getByText('ذكّرني')).toBeTruthy();
});

test('guests see the session but no «ذكّرني»', async () => {
  mockUser.current = { id: 'g', role: 'student', isGuest: true, gender: null };
  await render(<LiveUpcomingCard sessions={sessions} remindedIds={NONE} />);
  expect(screen.getByText('شرح الأصول الثلاثة')).toBeTruthy();
  expect(screen.queryByText('ذكّرني')).toBeNull();
});
