/**
 * «الحلقة» moderation (V23 P4, PLAN_LIVE_V23 §7.6): what a moderator can do
 * from the room, pinned on the Arabic copy.
 *
 * Invariants: the requests strip lists raised hands OLDEST first (handAt) with
 * the REAL name for staff (D2 — a sister who chose «بدون اسم» included);
 * RequestSheet approves / rejects through liveStore.moderate; a refusal shows
 * as one Arabic line (a guest: «الضيف يستمع فقط، ولا يمكن إعطاؤه الكلمة»);
 * PersonSheet offers only what liveRules allows by target role — mute a
 * speaker/moderator with an open mic (never the host), demote a speaker only
 * (never a moderator), with the gendered «إعادته / إعادتها إلى الاستماع»;
 * ManageSheet's «استقبال طلبات الكلمة» switch calls setAllowRequests.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCollapse = jest.fn();
jest.mock('@/components/live/LivePeekSheet', () => ({
  LivePeekSheet: ({ children }: { children: (c: () => void) => unknown }) => children(mockCollapse),
}));
jest.mock('@/components/live/Halaqa', () => ({ Halaqa: () => null }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 's1' }),
  useRouter: () => mockRouter,
}));

const mockUser: { current: Record<string, unknown> } = { current: {} };
jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockUser.current }),
  useUpdateProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));

const mockSession: { current: Record<string, unknown> | null } = { current: null };
// D2: staff get real names from the staff-only RPC — never from LiveKit.
const mockStaff = [
  { identity: 'sis', displayName: 'مريم', hiddenName: true, gender: 'f', role: 'listener' },
  { identity: 'bro', displayName: 'خالد', hiddenName: false, gender: 'm', role: 'listener' },
];
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession.current, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: mockStaff }),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { LiveControlError } from '@/api/live';
import { PersonSheet } from '@/components/live/sheets/PersonSheet';
import LiveRoomScreen from '../../app/live/[id]';

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

function person(id: string, over: Record<string, unknown>) {
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
  };
}

const ME = 'mod-me';
const people = {
  [ME]: person(ME, { name: 'المشرف', role: 'moderator', isMe: true }),
  host: person('host', { name: 'الشيخ عبد الله', role: 'host', micOn: true }),
  // Raised LATER than the sister's.
  bro: person('bro', { name: 'خالد', hand: true, handAt: 1_790_000_600 }),
  // A sister who chose «بدون اسم»: LiveKit says «طالبة», staff see her name.
  sis: person('sis', { name: 'طالبة', gender: 'f', hidden: true, hand: true, handAt: 1_790_000_000 }),
  sp: person('sp', { name: 'سعيد', role: 'speaker', micOn: true }),
};

const mockModerate = jest.fn();
beforeEach(() => {
  mockModerate.mockReset();
  mockModerate.mockResolvedValue(undefined);
  mockSession.current = session;
  mockUser.current = { id: 'u-sheikh', role: 'sheikh', isGuest: false, displayName: 'المشرف', gender: 'male' };
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    session,
    conn: 'ok',
    me: { identity: ME, role: 'moderator', hidden: false, gender: 'm' },
    people,
    counts: { brothers: 3, sisters: 1 },
    activeSpeakers: [],
    hostPresent: true,
    paused: false,
    preferredIdentity: null,
    lastError: null,
    notice: null,
    micOn: false,
    handBusy: false,
    micBusy: false,
    allowRequests: true,
    join: jest.fn(),
    leave: jest.fn(() => Promise.resolve()),
    setPaused: jest.fn(),
    setPreferredIdentity: jest.fn(),
    raiseHand: jest.fn(),
    lowerHand: jest.fn(),
    setMic: jest.fn(),
    stepDown: jest.fn(),
    moderate: mockModerate,
    setAllowRequests: jest.fn(() => Promise.resolve()),
    handOver: jest.fn(),
    endForAll: jest.fn(),
    clearNotice: jest.fn(),
  });
});

test('the requests strip lists raised hands oldest first, with real names for staff (D2)', async () => {
  await render(<LiveRoomScreen />);
  const chips = screen.getAllByLabelText(/(يطلب|تطلب) الكلمة$/);
  expect(chips.map((c) => c.props.accessibilityLabel)).toEqual(['مريم · تطلب الكلمة', 'خالد · يطلب الكلمة']);
  expect(screen.queryByText('طالبة')).toBeNull(); // the LiveKit alias is not what staff see
});

test('RequestSheet «السماح بالكلمة» approves that person and closes', async () => {
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('خالد · يطلب الكلمة'));
  expect(screen.getByText('السماح بالكلمة')).toBeTruthy();
  await fireEvent.press(screen.getByText('السماح بالكلمة'));
  expect(mockModerate).toHaveBeenCalledWith('approve', 'bro');
  expect(screen.queryByText('السماح بالكلمة')).toBeNull();
});

test('RequestSheet «الاعتذار» rejects', async () => {
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('مريم · تطلب الكلمة'));
  await fireEvent.press(screen.getByText('الاعتذار'));
  expect(mockModerate).toHaveBeenCalledWith('reject', 'sis');
});

test('approving a guest shows «الضيف يستمع فقط، ولا يمكن إعطاؤه الكلمة» and keeps the sheet', async () => {
  mockModerate.mockRejectedValue(new LiveControlError('guest_cannot_speak'));
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('خالد · يطلب الكلمة'));
  await fireEvent.press(screen.getByText('السماح بالكلمة'));
  await act(async () => {});
  expect(screen.getByText('الضيف يستمع فقط، ولا يمكن إعطاؤه الكلمة')).toBeTruthy();
  expect(screen.getByText('الاعتذار')).toBeTruthy(); // still open — they can decline instead
});

test('a listener sees no requests strip (moderators only)', async () => {
  Object.assign(mockState, { me: { identity: ME, role: 'listener', hidden: false, gender: 'm' } });
  mockUser.current = { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' };
  await render(<LiveRoomScreen />);
  expect(screen.queryByLabelText('خالد · يطلب الكلمة')).toBeNull();
  expect(screen.queryByLabelText('إدارة المجلس')).toBeNull();
});

test('ManageSheet: «استقبال طلبات الكلمة» off → setAllowRequests(false)', async () => {
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByLabelText('إدارة المجلس'));
  expect(screen.getByText('المتحدثون الآن · ١')).toBeTruthy(); // سعيد — not the host, not me
  const sw = screen.getByLabelText('استقبال طلبات الكلمة');
  await fireEvent(sw, 'change', { nativeEvent: { value: false } });
  expect(mockState.setAllowRequests).toHaveBeenCalledWith(false);
});

test('«في الحلقة» row → PersonSheet for that attendee', async () => {
  jest.useFakeTimers();
  try {
    await render(<LiveRoomScreen />);
    await fireEvent.press(screen.getAllByLabelText('من في الحلقة')[0]);
    await fireEvent.press(screen.getByText('سعيد'));
    await act(async () => {
      jest.advanceTimersByTime(500); // iOS: the people sheet dismisses first
    });
    await fireEvent.press(screen.getByText('إعادته إلى الاستماع'));
    expect(mockModerate).toHaveBeenCalledWith('demote', 'sp');
  } finally {
    jest.useRealTimers();
  }
});

// ─── PersonSheet: actions by target role ────────────────────────────────────

async function renderPerson(p: ReturnType<typeof person>, name = 'سعيد') {
  const onClose = jest.fn();
  await render(
    <PersonSheet visible onClose={onClose} identity={p.identity} person={p as never} name={name} canModerate />,
  );
  return onClose;
}

test('speaker with an open mic: «إغلاق الميكروفون» mutes, «إعادته إلى الاستماع» demotes', async () => {
  const onClose = await renderPerson(person('sp', { role: 'speaker', micOn: true }));
  await fireEvent.press(screen.getByText('إغلاق الميكروفون'));
  expect(mockModerate).toHaveBeenCalledWith('mute', 'sp');
  expect(onClose).toHaveBeenCalled();
  await fireEvent.press(screen.getByText('إعادته إلى الاستماع'));
  expect(mockModerate).toHaveBeenCalledWith('demote', 'sp');
});

test('a sister speaker with her mic closed: only «إعادتها إلى الاستماع»', async () => {
  await renderPerson(person('sp2', { role: 'speaker', gender: 'f', micOn: false }), 'فاطمة');
  expect(screen.queryByText('إغلاق الميكروفون')).toBeNull();
  await fireEvent.press(screen.getByText('إعادتها إلى الاستماع'));
  expect(mockModerate).toHaveBeenCalledWith('demote', 'sp2');
});

test('a moderator is never demoted — mute only', async () => {
  await renderPerson(person('m2', { role: 'moderator', micOn: true }), 'مشرف آخر');
  expect(screen.getByText('إغلاق الميكروفون')).toBeTruthy();
  expect(screen.queryByText('إعادته إلى الاستماع')).toBeNull();
});

test('the host is never muted', async () => {
  await renderPerson(person('host', { role: 'host', micOn: true }), 'الشيخ عبد الله');
  expect(screen.queryByText('إغلاق الميكروفون')).toBeNull();
  expect(screen.queryByText('إعادته إلى الاستماع')).toBeNull();
});

test('a listener with a raised hand: approve / reject from PersonSheet too', async () => {
  await renderPerson(person('bro', { hand: true, handAt: 1_790_000_600 }), 'خالد');
  await fireEvent.press(screen.getByText('السماح بالكلمة'));
  expect(mockModerate).toHaveBeenCalledWith('approve', 'bro');
});

test('a failed mute shows a short Arabic line, not a code', async () => {
  mockModerate.mockRejectedValue(new LiveControlError('not_present'));
  await renderPerson(person('sp', { role: 'speaker', micOn: true }));
  await fireEvent.press(screen.getByText('إغلاق الميكروفون'));
  await act(async () => {});
  expect(screen.getByText('غادر الحلقة')).toBeTruthy();
  expect(screen.queryByText('not_present')).toBeNull();
});
