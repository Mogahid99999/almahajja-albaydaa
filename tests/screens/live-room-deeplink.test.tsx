/**
 * «الحلقة» on the REAL router (expo-router/testing-library: ExpoRoot, its Stack
 * fork, its linking listener) — found on R5CX10P3BPL, 2026-09-30, sheikh account.
 *
 * The sheikh sat in the ended room of A («انتهى المجلس»); riwaqalilm://live/<B>
 * for a new session was delivered to the running app. expo-router's Stack
 * treats `live/[id]` with another id as another screen: the link PUSHES room B
 * over room A. Once B was joined, room A (still mounted beneath) saw it was left
 * and closed with router.back() — which popped room B: joined as host, mic on,
 * no room. A first fix pulled room A out from under B instead; on Android that
 * froze react-native-screens: B never showed, and neither did a second link or
 * the mini-bar afterwards. Invariants here: the new room is on top and shown;
 * the covered room stays put (never removed from under the top screen) and
 * goes together with the new one when that closes; after that, the mini-bar
 * and a second link each show the room.
 *
 * Only the data seams are mocked (hooks, the live store); navigation is real.
 * Jest runs the iOS branch of LivePeekSheet — the same close logic as Android.
 */
import { Text, View } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/components/live/Halaqa', () => ({ Halaqa: () => null }));

jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({
    data: { id: 'u-sh', role: 'sheikh', isGuest: false, displayName: 'الشيخ عبد الله', gender: 'male' },
  }),
  useUpdateProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));

// Session rows by id, in a tiny zustand store so a row arriving re-renders the room.
jest.mock('@/hooks/useLive', () => {
  const { create } = require('zustand');
  const mockRows = create(() => ({}));
  return {
    mockRows,
    useLiveSession: (id: string) => {
      const row = mockRows((s: Record<string, unknown>) => s[id]);
      return row ? { data: row, isLoading: false } : { data: undefined, isLoading: true };
    },
    useLiveStaffParticipants: () => ({ data: [] }),
  };
});
jest.mock('@/hooks/useLiveComments', () => ({
  useLiveComments: () => ({ comments: [], isLoading: false, isError: false, refetch: jest.fn(), unseen: 0 }),
  usePostLiveComment: () => ({ mutate: jest.fn(), isPending: false }),
  useLiveCommentAction: () => ({ mutate: jest.fn(), isPending: false, variables: undefined }),
}));
// The live store as a real zustand store (subscribers re-render), actions mocked.
jest.mock('@/stores/liveStore', () => {
  const { create } = require('zustand');
  return { useLiveStore: create(() => ({})) };
});

import { LiveMiniBar } from '@/components/live/LiveMiniBar';
import { Stack } from 'expo-router';
import * as liveHooks from '@/hooks/useLive';
import { useLiveStore } from '@/stores/liveStore';
import LiveRoomScreen from '../../app/live/[id]';

type Obj = Record<string, unknown>;
const rows = (liveHooks as unknown as { mockRows: { setState: (p: Obj) => void } }).mockRows;
const store = useLiveStore as unknown as { setState: (p: Obj) => void; getState: () => Obj };

function row(id: string, title: string, status: string) {
  return {
    id,
    sectionId: 'sec1',
    sectionTitle: 'العقيدة',
    sheikhId: 'sh1',
    sheikhName: 'الشيخ عبد الله',
    title,
    status,
    scheduledAt: null,
    startedAt: '2026-09-30T18:00:00Z',
    endedAt: null,
    shareCode: 'ABC234',
    peakListeners: 0,
  };
}
const A_TITLE = 'شرح كتاب التوحيد';
const B_TITLE = 'مجلس الإخلاص';
const HOST = { identity: 'host-id', role: 'host', hidden: false, gender: 'm' };

/** Root layout: the room presented like app/_layout.tsx presents it. */
function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="live/[id]" options={{ presentation: 'transparentModal' }} />
    </Stack>
  );
}
/** /sheikh: the questions inbox with the (real) live mini-bar, as on the device. */
function SheikhPage() {
  return (
    <View style={{ flex: 1 }}>
      <Text>أسئلة طلبة العلم</Text>
      <LiveMiniBar />
    </View>
  );
}

let deliverUrl: ((e: { url: string }) => void) | null = null;
let mockJoin: jest.Mock;

beforeEach(() => {
  deliverUrl = null;
  // The router's own link listener (expo-router subscribes through expo-linking).
  jest
    .spyOn(require('expo-linking'), 'addEventListener')
    .mockImplementation(((type: string, cb: (e: { url: string }) => void) => {
      if (type === 'url') deliverUrl = cb;
      return { remove() {} };
    }) as never);
  // Like the real join(): the new session replaces the old one in the store, then connects.
  mockJoin = jest.fn(async (sess: Obj) => {
    store.setState({ session: sess, conn: 'connecting', me: HOST });
    await Promise.resolve();
    store.setState({ conn: 'ok' });
  });
  rows.setState({ A: undefined, B: undefined });
  store.setState({
    session: null,
    conn: 'idle',
    me: null,
    people: {},
    counts: { brothers: 0, sisters: 0 },
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
    join: mockJoin,
    leave: jest.fn(async () => {}),
    setPaused: jest.fn(),
    setPreferredIdentity: jest.fn(),
    raiseHand: jest.fn(),
    lowerHand: jest.fn(),
    setMic: jest.fn(),
    stepDown: jest.fn(),
    moderate: jest.fn(),
    setAllowRequests: jest.fn(),
    handOver: jest.fn(async () => {}),
    endForAll: jest.fn(async () => {}),
    clearNotice: jest.fn(),
  });
});

type Router = ReturnType<typeof renderRouter>;

/** The root Stack (inside expo-router's __root): [name, id] per route, top last. */
function stack(r: Router): string[] {
  const root = r.getRouterState() as { routes: { state?: Obj }[] } | undefined;
  const st = root?.routes?.[0]?.state as { routes: { name: string; params?: { id?: string } }[] } | undefined;
  return (st?.routes ?? []).map((x) => (x.params?.id ? `${x.name}:${x.params.id}` : x.name));
}

async function flush() {
  await act(async () => {});
  await act(async () => {});
}

/** The top room's «تصغير» (the covered room renders too; the top one is last). */
function lastMinimise() {
  const all = screen.getAllByLabelText('تصغير');
  return all[all.length - 1];
}

async function openLink(url: string) {
  expect(deliverUrl).toBeTruthy();
  await act(async () => {
    deliverUrl!({ url });
  });
  await flush();
}

/** /sheikh → room A (joined as host) → A ends from elsewhere → «انتهى المجلس». */
async function inEndedRoomA(): Promise<{ r: Router }> {
  const r = renderRouter(
    { _layout: Layout, 'sheikh/index': SheikhPage, 'live/[id]': LiveRoomScreen },
    { initialUrl: '/sheikh' },
  );
  await (r as unknown as Promise<unknown>); // RNTL 14: render is async
  rows.setState({ A: row('A', A_TITLE, 'live') });
  await act(async () => {
    store.setState({ session: row('A', A_TITLE, 'live'), conn: 'ok', me: HOST });
  });
  await openLink('riwaqalilm://live/A');
  expect(screen.getByText(A_TITLE)).toBeTruthy();
  await act(async () => {
    rows.setState({ A: row('A', A_TITLE, 'ended') });
    store.setState({ conn: 'ended' });
  });
  expect(screen.getByText('انتهى المجلس')).toBeTruthy();
  expect(r.getPathname()).toBe('/live/A');
  return { r }; // wrapped: `r` is a thenable (RNTL 14), an async return would unwrap it
}

test('a link to a new live while the ended room is open shows the new room', async () => {
  const { r } = await inEndedRoomA();
  rows.setState({ B: row('B', B_TITLE, 'live') });

  await openLink('riwaqalilm://live/B');

  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(mockJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 'B' }), undefined);
  expect((store.getState().session as { id: string }).id).toBe('B');
  // Room B is on top and shown; room A stays beneath — never removed from under
  // the top screen (that froze react-native-screens on the device).
  expect(r.getPathname()).toBe('/live/B');
  expect(stack(r)).toEqual(['sheikh/index', 'live/[id]:A', 'live/[id]:B']);
  expect(screen.getByText(B_TITLE)).toBeTruthy();
});

test('the new session still loading when the link lands: then its room, never a close', async () => {
  const { r } = await inEndedRoomA();

  await openLink('riwaqalilm://live/B'); // B's row not fetched yet
  expect(r.getPathname()).toBe('/live/B');
  expect(mockJoin).not.toHaveBeenCalled();

  await act(async () => {
    rows.setState({ B: row('B', B_TITLE, 'live') });
  });
  await flush();
  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(r.getPathname()).toBe('/live/B');
  expect(stack(r)).toEqual(['sheikh/index', 'live/[id]:A', 'live/[id]:B']);
  expect(screen.getByText(B_TITLE)).toBeTruthy();
});

test('B joined and the room minimised: the old room goes with it, and the mini-bar shows the room', async () => {
  const { r } = await inEndedRoomA();
  rows.setState({ B: row('B', B_TITLE, 'live') });
  await openLink('riwaqalilm://live/B');
  expect(stack(r)).toEqual(['sheikh/index', 'live/[id]:A', 'live/[id]:B']);
  expect(screen.getByText(B_TITLE)).toBeTruthy();

  await fireEvent.press(lastMinimise()); // room B's chevron
  await flush();
  expect(r.getPathname()).toBe('/sheikh');
  expect(stack(r)).toEqual(['sheikh/index']); // A left together with B — no ended room revealed
  expect(screen.queryByText('انتهى المجلس')).toBeNull();

  await fireEvent.press(screen.getByLabelText(`العودة إلى الحلقة: ${B_TITLE}`));
  await flush();
  expect(r.getPathname()).toBe('/live/B');
  expect(stack(r)).toEqual(['sheikh/index', 'live/[id]:B']);
  expect(screen.getByText(B_TITLE)).toBeTruthy();
  expect(mockJoin).toHaveBeenCalledTimes(1); // already in B: no re-join
});

test('a second link to the joined session shows the room', async () => {
  const { r } = await inEndedRoomA();
  rows.setState({ B: row('B', B_TITLE, 'live') });
  await openLink('riwaqalilm://live/B');

  // While room B is up: the same room, nothing stacked or closed.
  await openLink('riwaqalilm://live/B');
  expect(r.getPathname()).toBe('/live/B');
  expect(stack(r)).toEqual(['sheikh/index', 'live/[id]:A', 'live/[id]:B']);
  expect(screen.getByText(B_TITLE)).toBeTruthy();

  // After minimising: the link brings the room back.
  await fireEvent.press(lastMinimise());
  await flush();
  expect(r.getPathname()).toBe('/sheikh');
  await openLink('riwaqalilm://live/B');
  expect(r.getPathname()).toBe('/live/B');
  expect(stack(r)).toEqual(['sheikh/index', 'live/[id]:B']);
  expect(screen.getByText(B_TITLE)).toBeTruthy();
  expect(mockJoin).toHaveBeenCalledTimes(1);
});
