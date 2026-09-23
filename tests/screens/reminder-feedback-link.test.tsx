/**
 * app/(student)/reminder/[id].tsx — the FEEDBACK_LINK action button opens the
 * in-app «إرسال ملاحظة» sheet instead of navigating (feedback-modal chip).
 *
 * Guards the one leg that can't be driven on web (the student reminder route
 * bounces admins to /admin and has no silent guest on web): tapping a reminder
 * whose link_url is the app://feedback sentinel must open FeedbackSheet, while a
 * normal /route reminder must still call router.push and NOT open the sheet.
 */
import { fireEvent, render } from '@testing-library/react-native';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'b1' }),
}));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/hooks/useAuth', () => ({ useCurrentUser: () => ({ data: { isGuest: true } }) }));
// VoiceNotePlayer pulls in expo-audio (native module) — the test broadcasts have
// no audio, so stub it at the component seam.
jest.mock('@/components/questions/VoiceNotePlayer', () => ({ VoiceNotePlayer: () => null }));

// FeedbackSheet's submit hook — keep it inert; we only assert the sheet opens.
const mockSubmit = { mutate: jest.fn(), reset: jest.fn(), isPending: false, error: null };
jest.mock('@/hooks/useFeedback', () => ({ useSubmitFeedback: () => mockSubmit }));

// The broadcast under test is swapped per-case via this holder.
const mockBroadcast: { current: Record<string, unknown> } = { current: {} };
jest.mock('@/hooks/useBroadcasts', () => ({
  useBroadcast: () => ({ data: mockBroadcast.current, isLoading: false }),
  useBroadcastImageUrl: () => ({ data: null }),
}));
jest.mock('@/api/broadcasts', () => ({
  FEEDBACK_LINK: 'app://feedback',
  getBroadcastAudioUrl: jest.fn(),
  recordBroadcastView: jest.fn(),
}));

import ReminderDetailScreen from '../../app/(student)/reminder/[id]';

const baseBroadcast = {
  id: 'b1',
  title: 'تذكير',
  body: 'نص التذكير',
  showOnHome: false,
  publishedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  imagePath: null,
  audioPath: null,
  linkUrl: null as string | null,
  linkLabel: null as string | null,
};

beforeEach(() => {
  mockRouter.push.mockClear();
  mockSubmit.mutate.mockClear();
});

test('the feedback-link button opens the إرسال ملاحظة sheet, not navigation', async () => {
  mockBroadcast.current = {
    ...baseBroadcast,
    linkUrl: 'app://feedback',
    linkLabel: 'إرسال ملاحظة',
  };
  const { getByText, queryByText } = await render(<ReminderDetailScreen />);

  // Sheet is closed initially (its guiding copy is not shown).
  expect(queryByText('نرحّب بملاحظاتك — تصل مباشرة إلى فريق العمل')).toBeNull();

  await fireEvent.press(getByText('إرسال ملاحظة'));

  // Now the FeedbackSheet is visible and no route push happened.
  expect(getByText('نرحّب بملاحظاتك — تصل مباشرة إلى فريق العمل')).toBeTruthy();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('a normal /route reminder button navigates and does NOT open the sheet', async () => {
  mockBroadcast.current = {
    ...baseBroadcast,
    linkUrl: '/(auth)/register',
    linkLabel: 'إنشاء حساب',
  };
  const { getByText, queryByText } = await render(<ReminderDetailScreen />);

  await fireEvent.press(getByText('إنشاء حساب'));

  expect(mockRouter.push).toHaveBeenCalledWith('/(auth)/register');
  expect(queryByText('نرحّب بملاحظاتك — تصل مباشرة إلى فريق العمل')).toBeNull();
});
