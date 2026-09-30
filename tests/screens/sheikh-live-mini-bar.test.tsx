/**
 * app/sheikh/index.tsx — the sheikh's questions page borrows the admin
 * SidebarDrawer but not the whole AdminShell, so it never had the live
 * mini-bar: a sheikh who minimised his live room there had no way back into
 * it (found on R5CX10P3BPL, 2026-09-30). The regression: the bar shows while a
 * live session is in the store, and not otherwise.
 */
import { render, screen } from '@testing-library/react-native';

import SheikhInboxScreen from '../../app/sheikh/index';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

const mockLive = { session: null as null | { id: string } };
jest.mock('@/stores/liveStore', () => ({
  useLiveStore: (sel: (s: typeof mockLive) => unknown) => sel(mockLive),
}));
jest.mock('@/components/live/LiveMiniBar', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { LiveMiniBar: () => <MockText>شريط البث المباشر</MockText> };
});
// The answer composer pulls the native voice recorder (expo-audio): not under test here.
jest.mock('@/components/questions/ModeratorAnswerComposer', () => ({ ModeratorAnswerComposer: () => null }));
jest.mock('@/components/questions/AnswerThread', () => ({ AnswerThread: () => null }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => (mockLive.session ? 118 : 0) }));
jest.mock('@/hooks/useAuth', () => ({ useSignOut: () => ({ mutate: jest.fn(), isPending: false }) }));
jest.mock('@/hooks/useNotifications', () => ({
  useNotificationPrefs: () => ({ data: { question_received: true } }),
  useSetNotificationPref: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useQuestions', () => ({
  useQuestionInbox: () => ({ data: [], isLoading: false }),
  useDeleteQuestion: () => ({ mutate: jest.fn(), isPending: false }),
}));

afterEach(() => {
  mockLive.session = null;
});

test('no live: the sheikh page has no live mini-bar', async () => {
  await render(<SheikhInboxScreen />);
  expect(screen.queryByText('شريط البث المباشر')).toBeNull();
});

test('a minimised live: the sheikh page shows the live mini-bar (his way back into the room)', async () => {
  mockLive.session = { id: 'sess-1' };
  await render(<SheikhInboxScreen />);
  expect(screen.getByText('شريط البث المباشر')).toBeTruthy();
});
