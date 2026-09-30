/**
 * The sheikh is drawn as an icon, never as a letter / number (owner 2026-09-29:
 * «نصف الحلقة يكون فيها ايقونة شيخ بدل الرقم او الحرف»): the halaqa's centre
 * medallion, the live mini-bar's avatar and the sheet headers show SheikhIcon,
 * announced with the sheikh's name.
 */
import { render, screen } from '@testing-library/react-native';

const mockLive: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockLive);
  useLiveStore.getState = () => mockLive;
  return { useLiveStore };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { Halaqa } from '@/components/live/Halaqa';
import type { LivePerson } from '@/components/live/liveTypes';
import { LiveMiniBar } from '@/components/live/LiveMiniBar';
import { PersonHeader } from '@/components/live/sheets/sheetParts';

const SHEIKH = 'الشيخ عبد الله';

function person(id: string, over: Record<string, unknown>): LivePerson {
  return {
    identity: id,
    name: 'مستمع',
    gender: 'm',
    role: 'listener',
    hidden: false,
    hand: false,
    handAt: null,
    micOn: false,
    speaking: false,
    isMe: false,
    ...over,
  } as LivePerson;
}

const people: Record<string, LivePerson> = {
  h1: person('h1', { name: SHEIKH, role: 'host', micOn: true }),
  l1: person('l1', { name: 'خالد' }),
  me: person('me', { name: 'أنا', isMe: true }),
};

/** No bare initial / digit anywhere in the tree. */
function expectNoInitial() {
  for (const t of ['ع', 'ا', '١', '1']) expect(screen.queryByText(t)).toBeNull();
}

test('the halaqa medallion shows the sheikh icon, labelled with his name', async () => {
  await render(
    <Halaqa
      size={360}
      people={people}
      counts={{ brothers: 2, sisters: 0 }}
      mode="live"
      hostOff={false}
      speakerId={null}
      paused={false}
      sheikhName={SHEIKH}
      nameOf={(_id, p) => p.name}
      onMorePress={jest.fn()}
    />,
  );
  expect(screen.getByRole('image', { name: SHEIKH })).toBeTruthy();
  expectNoInitial();
});

test('host away: the dashed medallion, no icon, «انقطع مؤقتاً»', async () => {
  await render(
    <Halaqa
      size={360}
      people={people}
      counts={{ brothers: 2, sisters: 0 }}
      mode="live"
      hostOff
      speakerId={null}
      paused={false}
      sheikhName={SHEIKH}
      nameOf={(_id, p) => p.name}
      onMorePress={jest.fn()}
    />,
  );
  expect(screen.queryByRole('image', { name: SHEIKH })).toBeNull();
  expect(screen.getByText('انقطع مؤقتاً')).toBeTruthy();
});

test('the mini-bar avatar is the sheikh icon (it used to show «١»)', async () => {
  Object.assign(mockLive, {
    session: { id: 's1', title: 'شرح كتاب التوحيد', sheikhName: SHEIKH },
    conn: 'ok',
    paused: false,
    people,
    activeSpeakers: [],
    me: { identity: 'me', role: 'listener', hidden: false, gender: 'm' },
    setPaused: jest.fn(),
    leave: jest.fn(),
  });
  await render(<LiveMiniBar />);
  expect(screen.getByText('الحلقة · شرح كتاب التوحيد')).toBeTruthy();
  expect(screen.getByRole('image', { name: SHEIKH })).toBeTruthy();
  expectNoInitial();
});

test('a sheet header for the host: the icon, and «الشيخ» when no name is known', async () => {
  await render(<PersonHeader gender="m" host sub="الشيخ" />);
  expect(screen.getByRole('image', { name: 'الشيخ' })).toBeTruthy();
});
