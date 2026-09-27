/**
 * onSessionLost — mid-session loss detection (sessionless-devices finding).
 *
 * supabase-js removes the session on its own after a non-retryable token
 * refresh failure. The app kept its cached "signed-in" user and every request
 * went out anonymous (prod: 19 Android devices / 150 rejected calls a day,
 * listening progress not syncing). A SIGNED_OUT the user did NOT ask for must
 * trigger recovery; a deliberate sign-out must not (its caller handles it).
 */

type AuthCb = (event: string) => void;
const mockListeners: AuthCb[] = [];
const mockEmit = (event: string) => mockListeners.forEach((l) => l(event));

jest.mock('@/lib/supabase', () => ({
  LAST_SESSION_KEY: 'last-session',
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCb) => {
        mockListeners.push(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => mockListeners.splice(mockListeners.indexOf(cb), 1),
            },
          },
        };
      },
      // A deliberate sign-out emits SIGNED_OUT while it runs, like supabase-js.
      signOut: async () => {
        mockEmit('SIGNED_OUT');
        return { error: null };
      },
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => {}),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => {}),
}));

import { onSessionLost, signOut } from '../auth';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-28T10:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

test('a SIGNED_OUT the user did not ask for triggers recovery', async () => {
  const cb = jest.fn();
  const off = onSessionLost(cb);
  mockEmit('SIGNED_OUT'); // e.g. refresh token rejected by the server
  await jest.runAllTimersAsync();
  expect(cb).toHaveBeenCalledTimes(1);
  off();
});

test('a deliberate sign-out does NOT trigger recovery', async () => {
  const cb = jest.fn();
  const off = onSessionLost(cb);
  await signOut();
  await jest.runAllTimersAsync();
  expect(cb).not.toHaveBeenCalled();
  off();
});

test('other auth events are ignored', async () => {
  const cb = jest.fn();
  const off = onSessionLost(cb);
  mockEmit('TOKEN_REFRESHED');
  mockEmit('USER_UPDATED');
  await jest.runAllTimersAsync();
  expect(cb).not.toHaveBeenCalled();
  off();
});
