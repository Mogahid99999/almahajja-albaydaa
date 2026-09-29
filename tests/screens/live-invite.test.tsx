/**
 * BuddyInviteSheet «ادعُ رفيقك إلى الحلقة» (V23 P5, §9.2 / §15 buddy,
 * invite_buddy_to_live + get_live_buddies_present in migration 0142).
 *
 * Pins: a buddy in the room is highlighted «رفيقك · حسن» (no invite button); an
 * absent one reads «رفيقك خالد ليس في الحلقة» with «ادعُه»; after sending the
 * row says «أُرسلت الدعوة إلى خالد» and can't be pressed again (once per buddy
 * per session — the server enforces it too); one already invited earlier comes
 * back disabled; sisters get «رفيقتك … ليست في الحلقة» / «ادعيها»; a refusal
 * shows the server's Arabic line.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

type Buddy = { buddyId: string; displayName: string };
const mockBuddies: { current: Buddy[] } = { current: [] };
jest.mock('@/hooks/useBuddy', () => ({
  useMyBuddies: () => ({ data: mockBuddies.current, isLoading: false }),
}));

const mockPresent: { current: { buddyId: string; identity: string }[] } = { current: [] };
const mockInvited: { current: string[] } = { current: [] };
type MutateOpts = { onSuccess?: () => void; onError?: (e: unknown) => void; onSettled?: () => void };
const mockInvite = jest.fn<void, [string, MutateOpts?]>();
jest.mock('@/hooks/useLive', () => ({
  useLiveBuddiesPresent: () => ({ data: mockPresent.current }),
  useLiveInvited: () => ({ data: mockInvited.current }),
  useInviteBuddyToLive: () => ({ mutate: mockInvite, isPending: false }),
}));
jest.mock('@/stores/liveStore', () => ({ useLiveStore: () => null }));

import { BuddyInviteSheet } from '@/components/live/sheets/BuddyInviteSheet';

const brothers: Buddy[] = [
  { buddyId: 'b-hasan', displayName: 'حسن' },
  { buddyId: 'b-khalid', displayName: 'خالد' },
];

beforeEach(() => {
  mockBuddies.current = brothers;
  mockPresent.current = [{ buddyId: 'b-hasan', identity: 'aaaaaaaaaaaaaaaa' }];
  mockInvited.current = [];
  mockInvite.mockReset();
  mockInvite.mockImplementation((_id, o) => {
    o?.onSuccess?.();
    o?.onSettled?.();
  });
});

const open = (gender: 'm' | 'f' = 'm', present?: ReadonlySet<string>) =>
  render(
    <BuddyInviteSheet
      visible
      onClose={jest.fn()}
      sessionId="s1"
      gender={gender}
      presentIdentities={present ?? new Set(['aaaaaaaaaaaaaaaa'])}
    />,
  );

test('a buddy in the room is highlighted «رفيقك · حسن»; an absent one can be invited', async () => {
  await open();
  expect(screen.getByText('ادعُ رفيقك إلى الحلقة')).toBeTruthy();
  expect(screen.getByText('رفيقك · حسن')).toBeTruthy();
  expect(screen.getByText('في الحلقة')).toBeTruthy();
  expect(screen.getByText('رفيقك خالد ليس في الحلقة')).toBeTruthy();
  expect(screen.getByLabelText('رفيقك خالد ليس في الحلقة · ادعُه')).toBeTruthy();
  // Only the absent buddy has an invite button.
  expect(screen.getAllByText('ادعُه')).toHaveLength(1);
});

test('invite once: «أُرسلت الدعوة إلى خالد», then the row is disabled', async () => {
  await open();
  await fireEvent.press(screen.getByText('ادعُه'));
  expect(mockInvite).toHaveBeenCalledTimes(1);
  expect(mockInvite).toHaveBeenCalledWith('b-khalid', expect.any(Object));

  expect(screen.getAllByText('أُرسلت الدعوة إلى خالد').length).toBeGreaterThan(0);
  expect(screen.queryByText('ادعُه')).toBeNull();
  await fireEvent.press(screen.getByLabelText('أُرسلت الدعوة إلى خالد'));
  expect(mockInvite).toHaveBeenCalledTimes(1); // never twice
});

test('a buddy already invited to this session comes back disabled', async () => {
  mockInvited.current = ['b-khalid'];
  await open();
  expect(screen.getAllByText('أُرسلت الدعوة إلى خالد').length).toBeGreaterThan(0);
  expect(screen.queryByText('ادعُه')).toBeNull();
});

test('a buddy the server still lists but who left the room reads as absent', async () => {
  await open('m', new Set());
  expect(screen.queryByText('رفيقك · حسن')).toBeNull();
  expect(screen.getByText('رفيقك حسن ليس في الحلقة')).toBeTruthy();
});

test('sisters: «رفيقتك مريم ليست في الحلقة» · «ادعيها»', async () => {
  mockBuddies.current = [{ buddyId: 'b-maryam', displayName: 'مريم' }];
  mockPresent.current = [];
  await open('f', new Set());
  expect(screen.getByText('ادعي رفيقتك إلى الحلقة')).toBeTruthy();
  expect(screen.getByText('رفيقتك مريم ليست في الحلقة')).toBeTruthy();
  expect(screen.getByLabelText('رفيقتك مريم ليست في الحلقة · ادعيها')).toBeTruthy();
  await fireEvent.press(screen.getByText('ادعيها'));
  expect(screen.getAllByText('أُرسلت الدعوة إلى مريم').length).toBeGreaterThan(0);
});

test('a refusal shows the server’s Arabic line and keeps the button', async () => {
  mockInvite.mockImplementation((_id, o) => {
    o?.onError?.({ message: 'ادخل الحلقة أولاً ثم ادعُ رفيقك' });
    o?.onSettled?.();
  });
  await open();
  await fireEvent.press(screen.getByText('ادعُه'));
  expect(screen.getByText('ادخل الحلقة أولاً ثم ادعُ رفيقك')).toBeTruthy();
  expect(screen.getByText('ادعُه')).toBeTruthy();
});
