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

const mockComments: { list: LiveComment[]; unseen: number; closed?: boolean; pinned?: LiveComment | null } = {
  list: [],
  unseen: 0,
};
const mockCommentsOpts: { enabled: boolean; open: boolean; stateEnabled?: boolean }[] = [];
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
      closed: mockComments.closed ?? false,
      pinned: mockComments.pinned ?? null,
    };
  },
  usePinLiveComment: () => ({ mutate: mockPin, isPending: false, variables: undefined }),
  usePostLiveComment: () => ({ mutate: mockPost, isPending: false }),
  useLiveCommentAction: () => ({ mutate: mockAction, isPending: false, variables: undefined }),
  useEditLiveComment: () => ({ mutate: mockEdit, isPending: false }),
  useSetLiveCommentsClosed: () => ({ mutate: mockClose, isPending: false }),
}));
const mockEdit = jest.fn();
const mockClose = jest.fn();
const mockPin = jest.fn();

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
  mockComments.pinned = null;
  mockPin.mockReset();
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
  // The room reads while connected; owner 2026-11-23: a listener sees the «n new» count too.
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: true, stateEnabled: true, open: true });
  expect(screen.getByLabelText('التعليقات والأسئلة · ٣ جديدة')).toBeTruthy();

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
  // In the room, connected, sheet never opened → no 500-comment read; only the
  // small state (0183: the pinned comment shows in the room for everyone).
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: false, stateEnabled: true, open: false });
  await fireEvent.press(screen.getByText('التعليقات'));
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: true, stateEnabled: true, open: true });

  mockCommentsOpts.length = 0;
  inRoom({
    user: { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' },
    me: { role: 'host', hidden: false, gender: 'm' },
  });
  await render(<LiveRoomScreen />);
  expect(mockCommentsOpts[mockCommentsOpts.length - 1]).toEqual({ enabled: true, stateEnabled: true, open: false });
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

// ─── 0182 (owner 2026-11-19): edit own comment, moderators close the comments ───

test('the author edits her own comment: «تعديل» fills the box, ✓ saves through live-control', async () => {
  inRoom({
    user: { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' },
    me: { role: 'listener', hidden: false, gender: 'f' },
  });
  mockComments.list = [comment('mine1', { text: 'تعليقي', name: 'مريم', gender: 'f', mine: true })];
  await openComments();
  await fireEvent.press(screen.getByText('تعليقي'));
  await fireEvent.press(screen.getByLabelText('تعديل'));
  expect(screen.getByText('تعديل تعليقك')).toBeTruthy();
  const box = screen.getByLabelText('اكتب تعليقاً أو سؤالاً');
  expect(box.props.value).toBe('تعليقي');
  await fireEvent.changeText(box, 'تعليقي بعد التعديل');
  await fireEvent.press(screen.getByLabelText('حفظ التعديل'));
  expect(mockEdit).toHaveBeenCalledWith({ id: 'mine1', text: 'تعليقي بعد التعديل' }, expect.anything());
  expect(mockPost).not.toHaveBeenCalled();
});

test('an edited comment shows «معدّل»; nobody may edit another person\'s comment', async () => {
  brother();
  mockComments.list = [comment('c9', { text: 'تعليق غيري', edited: true })];
  await openComments();
  expect(screen.getByText(/معدّل/)).toBeTruthy();
  expect(screen.queryByLabelText('تعديل')).toBeNull();
});

test('closed comments: a listener sees «أُغلقت التعليقات», no box, no «تعديل»', async () => {
  inRoom({
    user: { id: 'u2', role: 'student', isGuest: false, displayName: 'مريم', gender: 'female' },
    me: { role: 'listener', hidden: false, gender: 'f' },
  });
  mockComments.closed = true;
  mockComments.list = [comment('mine1', { text: 'تعليقي', name: 'مريم', gender: 'f', mine: true })];
  await openComments();
  expect(screen.getByText('أُغلقت التعليقات في هذا المجلس')).toBeTruthy();
  expect(screen.queryByLabelText('اكتب تعليقاً أو سؤالاً')).toBeNull();
  await fireEvent.press(screen.getByText('تعليقي'));
  expect(screen.queryByLabelText('تعديل')).toBeNull();
  expect(screen.getByLabelText('حذف')).toBeTruthy();
  mockComments.closed = false;
});

test('the host closes and reopens the comments; while closed he still writes', async () => {
  inRoom({
    user: { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' },
    me: { role: 'host', hidden: false, gender: 'm' },
  });
  await openComments();
  await fireEvent.press(screen.getByLabelText('إغلاق التعليقات'));
  expect(mockClose).toHaveBeenCalledWith(true, expect.anything());

  mockComments.closed = true;
  await openComments();
  expect(screen.getByText('التعليقات مغلقة للحاضرين، ويمكنك أنت الكتابة')).toBeTruthy();
  expect(screen.getByLabelText('اكتب تعليقاً أو سؤالاً')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('فتح التعليقات'));
  expect(mockClose).toHaveBeenCalledWith(false, expect.anything());
  mockComments.closed = false;
});

test('a listener has no close button', async () => {
  brother();
  await openComments();
  expect(screen.queryByLabelText('إغلاق التعليقات')).toBeNull();
});

// ─── 0183 (owner 2026-11-22): pinned comment + the mic inside the comments ─────

const host = () =>
  inRoom({
    user: { id: 'a1', role: 'sheikh', isGuest: false, displayName: 'الشيخ', gender: 'male' },
    me: { role: 'host', hidden: false, gender: 'm' },
  });

test('a pinned comment shows in the room for a listener and opens the comments; no unpin for him', async () => {
  brother();
  const p = comment('p1', { text: 'رابط الكتاب في الوصف', name: null });
  mockComments.pinned = p;
  mockComments.list = [p];
  await render(<LiveRoomScreen />);
  expect(screen.getByText('رابط الكتاب في الوصف')).toBeTruthy();
  expect(screen.getByText('تعليق مثبّت')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('تعليق مثبّت، اضغط لفتح التعليقات: رابط الكتاب في الوصف'));
  expect(screen.getByText('التعليقات والأسئلة')).toBeTruthy();
  expect(screen.queryByLabelText('إلغاء التثبيت')).toBeNull();
  expect(screen.queryByLabelText('تثبيت')).toBeNull();
});

test('the host pins a comment from its row and unpins it from the card', async () => {
  host();
  mockComments.list = [comment('c1', { text: 'سؤال مهم للجميع' })];
  await openComments();
  await fireEvent.press(screen.getByText('سؤال مهم للجميع'));
  await fireEvent.press(screen.getByLabelText('تثبيت'));
  expect(mockPin).toHaveBeenLastCalledWith('c1', expect.anything());

  mockComments.pinned = mockComments.list[0];
  await openComments();
  await fireEvent.press(screen.getAllByLabelText('إلغاء التثبيت')[0]);
  expect(mockPin).toHaveBeenLastCalledWith(null, expect.anything());
});

test('whoever holds a mic toggles it inside the comments; a listener has no mic there', async () => {
  host();
  await openComments();
  // The dock's mic and the one beside the composer.
  expect(screen.getAllByLabelText('فتح الميكروفون')).toHaveLength(2);
  await fireEvent.press(screen.getAllByLabelText('فتح الميكروفون').slice(-1)[0]);
  expect(mockState.setMic).toHaveBeenCalledWith(true);

  // Closed comments for a speaker: no box, but the mic stays at hand.
  inRoom({
    user: { id: 'u1', role: 'student', isGuest: false, displayName: 'أحمد', gender: 'male' },
    me: { role: 'speaker', hidden: false, gender: 'm' },
  });
  Object.assign(mockState, { micOn: true });
  mockComments.closed = true;
  await openComments();
  expect(screen.getByText('أُغلقت التعليقات في هذا المجلس')).toBeTruthy();
  await fireEvent.press(screen.getAllByLabelText('إغلاق الميكروفون').slice(-1)[0]);
  expect(mockState.setMic).toHaveBeenLastCalledWith(false);
  mockComments.closed = false;

  brother();
  Object.assign(mockState, { micOn: false });
  await openComments();
  expect(screen.queryByLabelText('فتح الميكروفون')).toBeNull();
});
