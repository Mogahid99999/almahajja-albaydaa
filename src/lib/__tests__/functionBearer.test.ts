/**
 * The 2026-11-13 regression: after hours in a live «مجلس» an admin's comments
 * failed with «تحقّق من الشبكة» while the server was fine — supabase-js
 * awaited a stuck auth session before every edge-function call. functionBearer
 * must not wait on it longer than SESSION_READ_DEADLINE_MS.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { env } from '@/lib/env';
import { AUTH_STORAGE_KEY, functionBearer, SESSION_READ_DEADLINE_MS, supabase } from '@/lib/supabase';

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const nowS = NOW / 1000;

function storeSession(accessToken: string, expiresAt: number) {
  return AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: accessToken, refresh_token: 'r', expires_at: expiresAt }));
}

describe('functionBearer — the stuck-session regression', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    await AsyncStorage.clear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses the live session token when GoTrue answers', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'live' } }, error: null } as never);
    await expect(functionBearer()).resolves.toBe('live');
  });

  it('falls back to the anon key when signed out', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null } as never);
    await expect(functionBearer()).resolves.toBe(env.supabaseAnonKey);
  });

  it('uses the stored token when the session lock is stuck', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockReturnValue(new Promise(() => {}) as never);
    await storeSession('stored', nowS + 3600);
    const p = functionBearer();
    await jest.advanceTimersByTimeAsync(SESSION_READ_DEADLINE_MS);
    await expect(p).resolves.toBe('stored');
  });

  it('gives up (null) when the lock is stuck and the stored token is about to expire', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockReturnValue(new Promise(() => {}) as never);
    await storeSession('stale', nowS + 30);
    const p = functionBearer();
    await jest.advanceTimersByTimeAsync(SESSION_READ_DEADLINE_MS);
    await expect(p).resolves.toBeNull();
  });
});
