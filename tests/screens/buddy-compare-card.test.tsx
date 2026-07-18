/**
 * src/components/journey/BuddyCompareCard.tsx — audit F-045: the buddy feature
 * is strictly gender-segregated, so every phrase must be fully feminine for
 * female users (the shipped bug addressed women with masculine imperatives and
 * had a dead ternary for the section title).
 */
import { render } from '@testing-library/react-native';

type Buddy = {
  buddyId: string;
  displayName: string;
  weekProgressPct: number;
  weeklyGoalMet: boolean;
  currentStreak: number;
};

const mockState: {
  user: { gender: 'male' | 'female' } | undefined;
  buddies: Buddy[] | undefined;
  streak: { current: number } | undefined;
} = { user: undefined, buddies: undefined, streak: undefined };

jest.mock('@/hooks/useAuth', () => ({ useCurrentUser: () => ({ data: mockState.user }) }));
jest.mock('@/hooks/useBuddy', () => ({ useMyBuddies: () => ({ data: mockState.buddies }) }));
jest.mock('@/hooks/useStreak', () => ({ useStreakStatus: () => ({ data: mockState.streak }) }));

import { BuddyCompareCard } from '@/components/journey/BuddyCompareCard';

const buddy = (over: Partial<Buddy> = {}): Buddy => ({
  buddyId: 'b1',
  displayName: 'رفيقة الدرب',
  weekProgressPct: 50,
  weeklyGoalMet: false,
  currentStreak: 2,
  ...over,
});

const week = (current: number, target: number) => ({ metric: 'lectures' as const, current, target });

/** Render and assert the encouragement phrase shown. */
const expectPhrase = async (weekProgress: ReturnType<typeof week>, phrase: string) => {
  const api = await render(<BuddyCompareCard week={weekProgress} />);
  expect(api.getByText(phrase)).toBeTruthy();
  await api.unmount(); // unmount is async in RNTL 14 — a dangling one pollutes the next render
};

beforeEach(() => {
  mockState.user = { gender: 'male' };
  mockState.buddies = [buddy()];
  mockState.streak = { current: 2 };
});

describe('render gating', () => {
  test('renders nothing without an accepted buddy', async () => {
    mockState.buddies = [];
    expect((await render(<BuddyCompareCard week={week(1, 3)} />)).toJSON()).toBeNull();
    mockState.buddies = undefined; // still loading
    expect((await render(<BuddyCompareCard week={week(1, 3)} />)).toJSON()).toBeNull();
  });

  test('one card per buddy (up to the server-capped 3)', async () => {
    mockState.buddies = [buddy(), buddy({ buddyId: 'b2', displayName: 'رفيق آخر' })];
    const { getAllByText } = await render(<BuddyCompareCard week={week(1, 3)} />);
    expect(getAllByText('أنت')).toHaveLength(2);
  });
});

describe('phrase selection (calm, never shaming)', () => {
  test('both met their goals', async () => {
    mockState.buddies = [buddy({ weeklyGoalMet: true })];
    await expectPhrase(week(3, 3), 'كلاكما أكمل هدفه الأسبوعي، بارك الله فيكما');
  });

  test('only the buddy met theirs — encouragement, not comparison', async () => {
    mockState.buddies = [buddy({ weeklyGoalMet: true })];
    await expectPhrase(week(1, 3), 'رفيقك أكمل هدفه الأسبوعي، فاستعن بالله وواصل');
  });

  test('only the user met theirs', async () => {
    await expectPhrase(week(3, 3), 'أتممت هدفك الأسبوعي، فاثبت وواصل');
  });

  test('streak tie-breaks when neither met the goal', async () => {
    mockState.streak = { current: 1 };
    mockState.buddies = [buddy({ currentStreak: 5 })];
    await expectPhrase(week(1, 3), 'رفيقك متقدم بخطوة، فامضِ أنت أيضًا');

    mockState.streak = { current: 5 };
    mockState.buddies = [buddy({ currentStreak: 1 })];
    await expectPhrase(week(1, 3), 'أنت متقدم بخطوة هذا الأسبوع، فاثبت وواصل');

    mockState.streak = { current: 2 };
    mockState.buddies = [buddy({ currentStreak: 2 })];
    await expectPhrase(week(1, 3), 'كلاكما مستمر، نسأل الله لكما الثبات');
  });

  test('a zero-target goal counts as not-met (no false congratulations)', async () => {
    await expectPhrase(week(0, 0), 'كلاكما مستمر، نسأل الله لكما الثبات');
  });
});

describe('feminine forms for female users (F-045)', () => {
  beforeEach(() => {
    mockState.user = { gender: 'female' };
  });

  test('section title uses the feminine wording', async () => {
    const { getByText } = await render(<BuddyCompareCard week={week(1, 3)} />);
    expect(getByText('أنتِ ورفيقاتك')).toBeTruthy();
  });

  test('every phrase branch is fully feminine', async () => {
    mockState.buddies = [buddy({ weeklyGoalMet: true })];
    await expectPhrase(week(3, 3), 'كلتاكما أكملت هدفها الأسبوعي، بارك الله فيكما');
    await expectPhrase(week(1, 3), 'رفيقتك أكملت هدفها الأسبوعي، فاستعيني بالله وواصلي');

    mockState.buddies = [buddy()];
    await expectPhrase(week(3, 3), 'أتممتِ هدفك الأسبوعي، فاثبتي وواصلي');
  });
});
