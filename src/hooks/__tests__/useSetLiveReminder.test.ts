/**
 * useSetLiveReminder — «ذكّرني» (V23 P5, set_live_reminder in migration 0142).
 *
 * Pins the optimistic contract the Home card relies on: the get_live_now cache
 * (remindedIds) flips BEFORE the server answers, a refusal rolls it back, and
 * cancelling removes the id again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

const mockSetLiveReminder = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/api/live', () => ({
  ...jest.requireActual('@/api/live'),
  setLiveReminder: (...a: unknown[]) => mockSetLiveReminder(...a),
}));
// The room store (LiveKit) is irrelevant here.
jest.mock('@/stores/liveStore', () => ({
  useLiveStore: () => null,
  notifyLiveSessionEnded: jest.fn(),
}));

import type { LiveNow } from '@/api/live';
import { queryKeys } from '@/constants/queryKeys';
import { useSetLiveReminder, withReminder } from '@/hooks/useLive';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const now: LiveNow = { live: null, upcoming: [], remindedIds: ['s0'], green: null };
  qc.setQueryData(queryKeys.liveNow, now);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

const ids = (qc: QueryClient) => qc.getQueryData<LiveNow>(queryKeys.liveNow)?.remindedIds;

/** Let the mutation settle and TanStack's batched notifications flush inside act(). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

beforeEach(() => mockSetLiveReminder.mockReset());

test('withReminder adds once and removes', () => {
  expect(withReminder(['a'], 'b', true)).toEqual(['a', 'b']);
  expect(withReminder(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
  expect(withReminder(['a', 'b'], 'a', false)).toEqual(['b']);
});

test('«ذكّرني»: the cache flips before the server answers', async () => {
  const { qc, wrapper } = setup();
  let resolve!: (v: boolean) => void;
  mockSetLiveReminder.mockImplementation(() => new Promise<boolean>((r) => (resolve = r)));
  const { result } = await renderHook(() => useSetLiveReminder(), { wrapper });

  await act(async () => {
    result.current.mutate({ sessionId: 's1', on: true });
  });
  expect(mockSetLiveReminder).toHaveBeenCalledWith('s1', true);
  expect(ids(qc)).toEqual(['s0', 's1']); // optimistic

  await act(async () => {
    resolve(true);
  });
  await settle();
  expect(ids(qc)).toEqual(['s0', 's1']);
});

test('a refused reminder rolls the cache back', async () => {
  const { qc, wrapper } = setup();
  mockSetLiveReminder.mockRejectedValue(new Error('لا يمكن التذكير بهذا المجلس'));
  const { result } = await renderHook(() => useSetLiveReminder(), { wrapper });

  await act(async () => {
    result.current.mutate({ sessionId: 's1', on: true });
  });
  await settle();
  expect(ids(qc)).toEqual(['s0']);
});

test('cancelling («سنذكّرك» tapped) removes the id', async () => {
  const { qc, wrapper } = setup();
  mockSetLiveReminder.mockResolvedValue(false);
  const { result } = await renderHook(() => useSetLiveReminder(), { wrapper });

  await act(async () => {
    result.current.mutate({ sessionId: 's0', on: false });
  });
  await settle();
  expect(mockSetLiveReminder).toHaveBeenCalledWith('s0', false);
  expect(ids(qc)).toEqual([]);
});
