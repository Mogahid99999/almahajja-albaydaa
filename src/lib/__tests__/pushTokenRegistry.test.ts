/**
 * LOAD V24 — the push token is upserted only when it (or the account) changed,
 * or weekly; before, every cold start wrote push_tokens again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  forgetPushTokenRegistration,
  needsPushTokenRegistration,
  PUSH_TOKEN_REFRESH_MS,
  registerPushTokenIfChanged,
} from '../pushTokenRegistry';

const NOW = 1_800_000_000_000;

test('register when never registered, the token changed, or another account signed in', () => {
  expect(needsPushTokenRegistration(null, 'T', 'u1', NOW)).toBe(true);
  expect(needsPushTokenRegistration({ token: 'T0', userId: 'u1', at: NOW }, 'T', 'u1', NOW)).toBe(true);
  expect(needsPushTokenRegistration({ token: 'T', userId: 'u0', at: NOW }, 'T', 'u1', NOW)).toBe(true);
});

test('skip within a week of the last write; refresh after it (and on a clock that went backwards)', () => {
  const memo = { token: 'T', userId: 'u1', at: NOW };
  expect(needsPushTokenRegistration(memo, 'T', 'u1', NOW + PUSH_TOKEN_REFRESH_MS - 1)).toBe(false);
  expect(needsPushTokenRegistration(memo, 'T', 'u1', NOW + PUSH_TOKEN_REFRESH_MS)).toBe(true);
  expect(needsPushTokenRegistration(memo, 'T', 'u1', NOW - 1)).toBe(true);
});

test('second cold start with the same token does not write; sign-out forgets it', async () => {
  await AsyncStorage.clear();
  const register = jest.fn(async () => undefined);
  await registerPushTokenIfChanged('T', 'u1', register);
  await registerPushTokenIfChanged('T', 'u1', register);
  expect(register).toHaveBeenCalledTimes(1);
  await forgetPushTokenRegistration();
  await registerPushTokenIfChanged('T', 'u1', register);
  expect(register).toHaveBeenCalledTimes(2);
});

test('a failed write is retried next time (nothing remembered)', async () => {
  await AsyncStorage.clear();
  const failing = jest.fn(async () => {
    throw new Error('offline');
  });
  await expect(registerPushTokenIfChanged('T', 'u1', failing)).rejects.toThrow('offline');
  const ok = jest.fn(async () => undefined);
  await registerPushTokenIfChanged('T', 'u1', ok);
  expect(ok).toHaveBeenCalledTimes(1);
});
