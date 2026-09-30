/**
 * useLiveComments — the room's comments cache («التعليقات والأسئلة», 0147).
 *
 * Pins the wiring the room relies on (no polling): get_live_comments fills the
 * cache when the room is usable; the room's data messages (forwarded by
 * liveStore.onLiveComments) keep it current; a message that lands WHILE the
 * read is in flight is replayed on its result (never lost); my own post shows
 * at once as «mine» and the broadcast of it doesn't duplicate it; the staff
 * badge counts what arrived since the list was last opened.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import type { LiveComment, LiveCommentsMessage } from '@/api/liveComments';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/api/liveComments', () => ({
  ...jest.requireActual('@/api/liveComments'),
  getLiveComments: (...a: unknown[]) => mockGet(...a),
  postLiveComment: (...a: unknown[]) => mockPost(...a),
}));
let mockListener: ((sessionId: string, msg: LiveCommentsMessage) => void) | null = null;
jest.mock('@/stores/liveStore', () => ({
  onLiveComments: (l: (sessionId: string, msg: LiveCommentsMessage) => void) => {
    mockListener = l;
    return () => {
      mockListener = null;
    };
  },
}));

import { useLiveComments, usePostLiveComment } from '@/hooks/useLiveComments';

const S = 'sess-1';
function c(id: string, sec: number, over: Partial<LiveComment> = {}): LiveComment {
  return {
    id,
    kind: 'comment',
    text: 'بارك الله فيكم',
    name: 'أحمد',
    gender: 'm',
    answered: false,
    at: `2026-09-30T18:00:${String(sec).padStart(2, '0')}.000Z`,
    ...over,
  };
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

/** A room data message, then TanStack's batched notification flushes. */
const push = async (msg: LiveCommentsMessage, sessionId = S) => {
  expect(mockListener).not.toBeNull();
  await act(async () => {
    mockListener?.(sessionId, msg);
  });
  await settle();
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

test('reads when enabled, then follows the room messages (add / ans / del)', async () => {
  const { wrapper } = setup();
  mockGet.mockResolvedValue([c('a', 1)]);
  const { result } = await renderHook(() => useLiveComments(S, { enabled: true, open: false }), { wrapper });
  await settle();
  expect(mockGet).toHaveBeenCalledWith(S);
  expect(result.current.comments.map((x) => x.id)).toEqual(['a']);

  await push({ t: 'add', c: c('q', 2, { kind: 'question' }) });
  expect(result.current.comments.map((x) => x.id)).toEqual(['a', 'q']);
  await push({ t: 'ans', id: 'q', answered: true });
  expect(result.current.comments[1].answered).toBe(true);
  await push({ t: 'del', id: 'a' });
  expect(result.current.comments.map((x) => x.id)).toEqual(['q']);

  // Another session's message is not ours.
  await push({ t: 'add', c: c('x', 3) }, 'other');
  expect(result.current.comments.map((x) => x.id)).toEqual(['q']);
});

test('not enabled (connecting / reconnecting) → no read', async () => {
  const { wrapper } = setup();
  await renderHook(() => useLiveComments(S, { enabled: false, open: false }), { wrapper });
  await settle();
  expect(mockGet).not.toHaveBeenCalled();
});

test('a message that arrives while the read is in flight is replayed on its result', async () => {
  const { wrapper } = setup();
  let resolve!: (v: LiveComment[]) => void;
  mockGet.mockImplementation(() => new Promise<LiveComment[]>((r) => (resolve = r)));
  const { result } = await renderHook(() => useLiveComments(S, { enabled: true, open: false }), { wrapper });

  await push({ t: 'add', c: c('late', 5) }); // the read started before this was stored
  await act(async () => {
    resolve([c('a', 1)]);
  });
  await settle();
  expect(result.current.comments.map((x) => x.id)).toEqual(['a', 'late']);
});

test('my post shows at once as mine; its broadcast does not duplicate it', async () => {
  const { wrapper } = setup();
  mockGet.mockResolvedValue([]);
  mockPost.mockResolvedValue(c('m', 4, { mine: true }));
  const { result } = await renderHook(
    () => ({ list: useLiveComments(S, { enabled: true, open: false }), post: usePostLiveComment(S) }),
    { wrapper },
  );
  await settle();
  await act(async () => {
    result.current.post.mutate({ kind: 'comment', text: 'سؤال', anonymous: false });
  });
  await settle();
  expect(mockPost).toHaveBeenCalledWith({ sessionId: S, kind: 'comment', text: 'سؤال', anonymous: false });
  await push({ t: 'add', c: c('m', 4) });
  expect(result.current.list.comments).toHaveLength(1);
  expect(result.current.list.comments[0].mine).toBe(true);
  expect(result.current.list.unseen).toBe(0); // my own never counts
});

test('the badge counts new ones until the list is opened', async () => {
  const { wrapper } = setup();
  mockGet.mockResolvedValue([c('a', 1)]);
  const { result, rerender } = await renderHook(
    ({ open }: { open: boolean }) => useLiveComments('sess-badge', { enabled: true, open }),
    { wrapper, initialProps: { open: false } },
  );
  await settle();
  expect(result.current.unseen).toBe(1);

  await rerender({ open: true });
  expect(result.current.unseen).toBe(0);
  await rerender({ open: false });
  expect(result.current.unseen).toBe(0); // seen stays seen

  await push({ t: 'add', c: c('b', 2) }, 'sess-badge');
  await push({ t: 'add', c: c('c', 3) }, 'sess-badge');
  expect(result.current.unseen).toBe(2);
  await push({ t: 'del', id: 'c' }, 'sess-badge');
  expect(result.current.unseen).toBe(1); // a deleted one leaves the count too
});
