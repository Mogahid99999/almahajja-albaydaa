/**
 * «التعليقات والأسئلة أثناء البث» in the room (app/live/[id].tsx + CommentsSheet,
 * migration 0147), pinned on the Arabic copy. Mocked at the hook seam
 * (useLiveComments / usePostLiveComment / useLiveCommentAction).
 *
 * Owner rules guarded here:
 *  - everyone present reads the list; a registered listener sends a comment or
 *    a question; a guest reads but is asked to register («سجّل أولاً») to write;
 *  - names: a brother may tick «بدون اسم»; a sister who sits in the room without
 *    her name is ALWAYS nameless (no option, a quiet line says so); a sister with
 *    her name is warned before sending named, and «أرسل بدون اسم» sends
 *    anonymous:true; a nameless comment shows «طالب» / «طالبة»;
 *  - the host / moderators / staff see how many are new on the entry pill, and
 *    act on a row: «حذف», «منع من التعليق» (after a confirm) — no «تمت الإجابة»
 *    and no «تعليق» / «سؤال» choice in the UI (owner 2026-09-30);
 *    a listener may delete only her own;
 *  - a refusal is one calm line (rate_limited «انتظر قليلاً ثم أرسل») and the
 *    draft is kept.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { LiveComment } from '@/api/liveComments';

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
jest.mock('@/hooks/useLive', () => ({
  useLiveSession: () => ({ data: mockSession.current, isLoading: false }),
  useLiveStaffParticipants: () => ({ data: [] }),
}));

const mockComments: { list: LiveComment[]; unseen: number } = { list: [], unseen: 0 };
const mockCommentsOpts: { enabled: boolean; open: boolean }[] = [];
const mockPost = jest.fn();
const mockAction = jest.fn();
jest.mock('@/hooks/useLiveComments', () => ({
  useLiveComments: (_id: string | null, opts: { enabled: boolean; open: boolean }) => {
    mockCommentsOpts.push(opts);
    return {
      comments: mockComments.list,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      unseen: mockComments.unseen,
    };
  },
  usePostLiveComment: () => ({ mutate: mockPost, isPending: false }),
  useLiveCommentAction: () => ({ mutate: mockAction, isPending: false, variables: undefined }),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@/stores/liveStore', () => {
  const useLiveStore = (sel: (s: Record<string, unknown>) => unknown) => sel(mockState);
  useLiveStore.getState = () => mockState;
  return { useLiveStore };
});

import { LiveControlError } from '@/api/live';
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
  startedAt: '2026-09-30T18:00:00Z',
  endedAt: null,
  shareCode: 'ABC234',
  peakListeners: 0,
};

const ME = 'b'.repeat(16);

function comment(id: string, over: Partial<LiveComment> = {}): LiveComment {
  return {
    id,
    kind: 'comment',
    text: 'جزاكم الله خيراً',
    name: 'خالد',
    gender: 'm',
    answered: false,
    at: '2026-09-30T18:05:00.000Z',
    ...over,
  };
}

function inRoom(opts: {
  user: Record<string, unknown>;
  me: { role: string; hidden: boolean; gender: 'm' | 'f' };
}) {
  mockUser.current = opts.user;
  Object.assign(mockState, {
    session,
    conn: 'ok',
    me: { identity: ME, ...opts.me },
    people: {
      [ME]: {
        identity: ME, name: 'أنا', gender: opts.me.gender, role: opts.me.role, hidden: opts.me.hidden,
        hand: false, handAt: null, micOn: false, speaking: false, isMe: true,
      },
    },
  });
}

const brother = () =>
  inRoom({
    user: { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' },
    me: { role: 'listener', hidden: false, gender: 'm' },
  });

async function openComments() {
  await render(<LiveRoomScreen />);
  await fireEvent.press(screen.getByText('التعليقات'));
  expect(screen.getByText('التعليقات والأسئلة')).toBeTruthy();
}

async function write(text: string, placeholder = 'اكتب تعليقاً أو سؤالاً') {
  await fireEvent.changeText(screen.getByLabelText(placeholder), text);
}

beforeEach(() => {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    session: null,
    conn: 'idle',
    me: null,
    people: {},
    counts: { brothers: 3, sisters: 2 },
    activeSpeakers: [],
    hostPresent: true,
    paused: false,
    preferredIdentity: 'named',
    lastError: null,
    join: jest.fn(async () => undefined),
    leave: jest.fn(() => Promise.resolve()),
    setPaused: jest.fn(),
    setPreferredIdentity: jest.fn(),
    notice: null,
    micOn: false,
    handBusy: false,
    micBusy: false,
    allowRequests: true,
    raiseHand: jest.fn(() => Promise.resolve()),
    lowerHand: jest.fn(() => Promise.resolve()),
    setMic: jest.fn(() => Promise.resolve()),
    stepDown: jest.fn(() => Promise.resolve()),
    moderate: jest.fn(() => Promise.resolve()),
    setAllowRequests: jest.fn(() => Promise.resolve()),
    handOver: jest.fn(() => Promise.resolve()),
    endForAll: jest.fn(() => Promise.resolve()),
    clearNotice: jest.fn(),
  });
  mockSession.current = session;
  mockComments.list = [];
  mockComments.unseen = 0;
  mockCommentsOpts.length = 0;
  mockPost.mockReset();
  mockAction.mockReset();
  mockRouter.push.mockReset();
});

test('a listener reads the list live and sends a comment, then a question', async () => {
  brother();
  mockComments.list = [
    comment('c1', { text: 'بارك الله فيكم يا شيخ' }),
    comment('c2', { kind: 'question', text: 'ما حكم المسألة؟', name: null, gender: 'f', answered: true }),
    comment('c3', { text: 'آمين', name: null, gender: 'm' }),
  ];
  mockComments.unseen = 3;
  await openComments();
  // The room reads while connected; a listener never sees the staff count.
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: true, open: true });
  expect(screen.queryByText('٣')).toBeNull();

  expect(screen.getByText('بارك الله فيكم يا شيخ')).toBeTruthy();
  expect(screen.getByText('خالد')).toBeTruthy();
  // Nameless: «طالبة» / «طالب». No «تعليق» / «سؤال» split and no «تمت الإجابة»
  // mark in the UI (owner 2026-09-30: every question gets answered).
  expect(screen.getByText('طالبة')).toBeTruthy();
  expect(screen.getByText('طالب')).toBeTruthy();
  expect(screen.queryByText('سؤال')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'سؤال' })).toBeNull();
  expect(screen.queryByText('تمت الإجابة')).toBeNull();
  // Someone else's comment has no actions for a listener.
  await fireEvent.press(screen.getByText('بارك الله فيكم يا شيخ'));
  expect(screen.queryByText('حذف')).toBeNull();

  await write('جزاكم الله خيراً');
  await fireEvent.press(screen.getByLabelText('إرسال'));
  expect(mockPost).toHaveBeenCalledWith(
    { kind: 'comment', text: 'جزاكم الله خيراً', anonymous: false },
    expect.anything(),
  );

});

test('a brother ticks «بدون اسم» → sent anonymous', async () => {
  brother();
  await openComments();
  expect(screen.getByText('يظهر باسمك: أحمد')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('بدون اسم'));
  expect(screen.getByText('يظهر «طالب» بدلاً من اسمك')).toBeTruthy();
  await write('سؤال الأخ');
  await fireEvent.press(screen.getByLabelText('إرسال'));
  expect(mockPost).toHaveBeenCalledWith({ kind: 'comment', text: 'سؤال الأخ', anonymous: true }, expect.anything());
});

test('a guest reads the list, but writing asks to register first', async () => {
  inRoom({
    user: { id: 'g1', role: 'student', isGuest: true, displayName: null, gender: 'male' },
    me: { role: 'listener', hidden: false, gender: 'm' },
  });
  mockComments.list = [comment('c1', { text: 'بارك الله فيكم' })];
  await openComments();
  expect(screen.getByText('بارك الله فيكم')).toBeTruthy();
  expect(screen.queryByLabelText('إرسال')).toBeNull();

  await fireEvent.press(screen.getByText('أضف تعليقاً أو سؤالاً'));
  expect(await screen.findByText('سجّل أولاً لتعلّق أو تسأل')).toBeTruthy();
  await fireEvent.press(screen.getByText('تسجيل'));
  expect(mockRouter.push).toHaveBeenCalledWith('/register');
  expect(mockPost).not.toHaveBeenCalled();
});

test('a sister in the room without her name has no name option — always nameless', async () => {
  inRoom({
    user: { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' },
    me: { role: 'listener', hidden: true, gender: 'f' },
  });
  await openComments();
  expect(screen.queryByLabelText('بدون اسم')).toBeNull();
  expect(screen.getByText('تظهر تعليقاتك وأسئلتك بدون اسم («طالبة»)، كما دخلتِ الحلقة.')).toBeTruthy();
  await write('سؤال الأخت');
  await fireEvent.press(screen.getByLabelText('إرسال'));
  // No warning: straight to a nameless send.
  expect(screen.queryByText('سيظهر ما تكتبينه باسمك لجميع الحاضرين في المجلس.')).toBeNull();
  expect(mockPost).toHaveBeenCalledWith({ kind: 'comment', text: 'سؤال الأخت', anonymous: true }, expect.anything());
});

test('a sister with her name is warned first; «أرسل بدون اسم» sends anonymous', async () => {
  inRoom({
    user: { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' },
    me: { role: 'listener', hidden: false, gender: 'f' },
  });
  await openComments();
  expect(screen.queryByLabelText('بدون اسم')).toBeNull();
  await write('فائدة');
  await fireEvent.press(screen.getByLabelText('إرسال'));
  expect(screen.getByText('سيظهر ما تكتبينه باسمك لجميع الحاضرين في المجلس.')).toBeTruthy();
  expect(mockPost).not.toHaveBeenCalled();

  // «إلغاء» goes back to the draft, nothing sent.
  await fireEvent.press(screen.getByText('إلغاء'));
  expect(screen.queryByText('سيظهر ما تكتبينه باسمك لجميع الحاضرين في المجلس.')).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('إرسال'));
  await fireEvent.press(screen.getByText('أرسل بدون اسم'));
  expect(mockPost).toHaveBeenCalledWith({ kind: 'comment', text: 'فائدة', anonymous: true }, expect.anything());

  // Asked again before the next named send; «أرسل باسمي» sends named.
  await fireEvent.press(screen.getByLabelText('إرسال'));
  await fireEvent.press(screen.getByText('أرسل باسمي'));
  expect(mockPost).toHaveBeenLastCalledWith({ kind: 'comment', text: 'فائدة', anonymous: false }, expect.anything());
});

test('LOAD V25: a listener reads the list only after first opening it; the host on join', async () => {
  brother();
  await render(<LiveRoomScreen />);
  // In the room, connected, sheet never opened → no 500-comment read.
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: false, open: false });
  await fireEvent.press(screen.getByText('التعليقات'));
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: true, open: true });

  mockCommentsOpts.length = 0;
  inRoom({
    user: { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' },
    me: { role: 'host', hidden: false, gender: 'm' },
  });
  await render(<LiveRoomScreen />);
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: true, open: false });
});

test('staff see the count of new ones and answer / delete / block', async () => {
  inRoom({
    user: { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' },
    me: { role: 'host', hidden: false, gender: 'm' },
  });
  mockComments.list = [
    comment('q1', { kind: 'question', text: 'ما معنى التوحيد؟' }),
    comment('c1', { text: 'تعليق غير لائق' }),
  ];
  mockComments.unseen = 3;
  await render(<LiveRoomScreen />);
  expect(screen.getByText('٣')).toBeTruthy();
  expect(screen.getByLabelText('التعليقات والأسئلة · ٣ جديدة')).toBeTruthy();
  await fireEvent.press(screen.getByText('التعليقات'));

  await fireEvent.press(screen.getByText('ما معنى التوحيد؟'));
  expect(screen.queryByLabelText('تمت الإجابة')).toBeNull();
  await fireEvent.press(screen.getByLabelText('حذف'));
  expect(mockAction).toHaveBeenLastCalledWith({ type: 'delete', id: 'q1' }, expect.anything());

  await fireEvent.press(screen.getByText('تعليق غير لائق'));
  await fireEvent.press(screen.getByLabelText('منع من التعليق'));
  expect(
    screen.getByText('يُمنع صاحب هذا التعليق من التعليق في هذا المجلس، ويُحذف تعليقه. لا يظهر لأحد من هو.'),
  ).toBeTruthy();
  expect(mockAction).not.toHaveBeenLastCalledWith({ type: 'block', id: 'c1' }, expect.anything());
  await fireEvent.press(screen.getByLabelText('منع'));
  expect(mockAction).toHaveBeenLastCalledWith({ type: 'block', id: 'c1' }, expect.anything());
});

test('a listener deletes her own comment', async () => {
  inRoom({
    user: { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' },
    me: { role: 'listener', hidden: false, gender: 'f' },
  });
  mockComments.list = [comment('mine1', { text: 'تعليقي', name: 'مريم', gender: 'f', mine: true })];
  await openComments();
  expect(screen.getByText('مريم · أنت')).toBeTruthy();
  await fireEvent.press(screen.getByText('تعليقي'));
  expect(screen.queryByLabelText('منع من التعليق')).toBeNull();
  await fireEvent.press(screen.getByLabelText('حذف'));
  expect(mockAction).toHaveBeenCalledWith({ type: 'delete', id: 'mine1' }, expect.anything());
});

test('rate_limited → «انتظر قليلاً ثم أرسل», and the draft is kept', async () => {
  brother();
  mockPost.mockImplementation((_v: unknown, o?: { onError?: (e: unknown) => void }) =>
    o?.onError?.(new LiveControlError('rate_limited')),
  );
  await openComments();
  await write('تعليق ثانٍ');
  await fireEvent.press(screen.getByLabelText('إرسال'));
  expect(screen.getByText('انتظر قليلاً ثم أرسل')).toBeTruthy();
  expect(screen.getByLabelText('اكتب تعليقاً أو سؤالاً').props.value).toBe('تعليق ثانٍ');
});

test('blocked_words / blocked / not_live read as calm lines', async () => {
  brother();
  const codes: [string, string][] = [
    ['blocked_words', 'في النص كلمات غير مناسبة، عدّله ثم أرسل'],
    ['blocked', 'لا يمكنك التعليق في هذا المجلس'],
    ['not_live', 'التعليق متاح أثناء البث المباشر'],
  ];
  await openComments();
  for (const [code, line] of codes) {
    mockPost.mockImplementationOnce((_v: unknown, o?: { onError?: (e: unknown) => void }) =>
      o?.onError?.(new LiveControlError(code)),
    );
    await write(`نص ${code}`);
    await fireEvent.press(screen.getByLabelText('إرسال'));
    expect(screen.getByText(line)).toBeTruthy();
  }
});

test('in the green room (not on air yet) the composer waits for the broadcast', async () => {
  inRoom({
    user: { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' },
    me: { role: 'host', hidden: false, gender: 'm' },
  });
  mockSession.current = { ...session, status: 'green' };
  Object.assign(mockState, { session: { ...session, status: 'green' } });
  await openComments();
  expect(screen.getByText('التعليق متاح أثناء البث المباشر')).toBeTruthy();
  expect(screen.queryByLabelText('إرسال')).toBeNull();
});
