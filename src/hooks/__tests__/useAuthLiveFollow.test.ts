/**
 * useAuth → «الحلقة»: the live room follows the signed-in user.
 *
 * Device report 2026-09-30: a guest in a live signed in as the sheikh and the
 * room stayed on the guest identity. Pins the wiring (the decision itself —
 * re-join / same id / no room — is pinned in src/stores/__tests__/liveStore.test.ts):
 *  - every signed-in user id set on the shared currentUser cache reaches
 *    liveStore.followAuthUser, and the cache cleared mid-switch is never
 *    reported as "no user";
 *  - sign-out leaves the live BEFORE the restored guest is reported.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

const mockFollow = jest.fn(async (_id: string) => undefined);
const mockLeave = jest.fn(async () => undefined);
jest.mock('@/stores/liveStore', () => ({
  followAuthUser: (id: string) => mockFollow(id),
  useLiveStore: { getState: () => ({ leave: () => mockLeave() }) },
}));
jest.mock('@/lib/queryClient', () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query');
  // gcTime Infinity: no 5-minute gc timers keeping Jest alive after the run.
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
    }),
  };
});
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@/api/auth', () => ({
  signIn: (...a: unknown[]) => mockSignIn(...a),
  signOut: () => mockSignOut(),
  ensureSession: jest.fn(async () => null),
  getCurrentUser: jest.fn(async () => null),
}));
jest.mock('@/api/notifications', () => ({ unregisterPushToken: jest.fn(async () => undefined) }));
jest.mock('@/lib/audioController', () => ({ stop: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ cancelAllLocalNotifications: jest.fn(async () => undefined) }));
jest.mock('@/lib/outbox', () => ({ clearOutbox: jest.fn(async () => undefined) }));
jest.mock('@/stores/notificationsStore', () => ({
  useNotificationsStore: { getState: () => ({ token: null, setRegistered: jest.fn() }) },
}));
jest.mock('@/stores/tourStore', () => ({ useTourStore: { getState: () => ({ start: jest.fn() }) } }));

import type { CurrentUser } from '@/api/auth';
import { queryKeys } from '@/constants/queryKeys';
import { useSignIn, useSignOut } from '@/hooks/useAuth';
import { queryClient } from '@/lib/queryClient';

const user = (id: string, over: Partial<CurrentUser> = {}): CurrentUser => ({
  id,
  email: '',
  phone: null,
  role: 'student',
  isGuest: false,
  displayName: null,
  gender: 'male',
  ...over,
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

/** TanStack batches cache notifications — let them flush. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  queryClient.clear();
  jest.clearAllMocks();
});

test('sign-in while in a live re-joins as the new user: the signed-in id reaches the live store', async () => {
  queryClient.setQueryData(queryKeys.currentUser, user('guest-1', { isGuest: true }));
  await flush();
  expect(mockFollow).toHaveBeenLastCalledWith('guest-1');

  mockSignIn.mockResolvedValue(user('sheikh-1', { role: 'sheikh' }));
  const { result } = await renderHook(() => useSignIn(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ identifier: 'sheikh@gmail.com', password: '12345678' });
  });
  await flush();

  expect(mockFollow).toHaveBeenLastCalledWith('sheikh-1');
  // qc.clear() in between is never reported as "no user".
  expect(mockFollow.mock.calls.every(([id]) => !!id)).toBe(true);
  // The store decides (it re-joins); sign-in itself never plain-leaves.
  expect(mockLeave).not.toHaveBeenCalled();
});

test('sign-out leaves the live BEFORE the restored guest is reported', async () => {
  queryClient.setQueryData(queryKeys.currentUser, user('student-1'));
  await flush();

  mockSignOut.mockResolvedValue(user('guest-1', { isGuest: true }));
  const { result } = await renderHook(() => useSignOut(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync();
  });
  await flush();

  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockFollow).toHaveBeenLastCalledWith('guest-1');
  expect(mockLeave.mock.invocationCallOrder[0]).toBeLessThan(mockFollow.mock.invocationCallOrder.at(-1)!);
});
