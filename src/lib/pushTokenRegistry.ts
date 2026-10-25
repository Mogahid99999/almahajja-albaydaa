/**
 * Push-token registration memo (LOAD V24). The notifications store's
 * `registered` flag lives for one run only, so every cold start used to upsert
 * push_tokens again (a write per launch, ~23k since June). Now the device
 * remembers what it registered and re-registers only when the token or the
 * account changed, or the last write is a week old (keeps updated_at fresh
 * for the server's stale-token pruning).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pushTokenRegistered.v1';
export const PUSH_TOKEN_REFRESH_MS = 7 * 24 * 3600_000;

export type PushTokenMemo = { token: string; userId: string; at: number };

export function needsPushTokenRegistration(
  prev: PushTokenMemo | null,
  token: string,
  userId: string,
  nowMs: number,
): boolean {
  if (!prev) return true;
  if (prev.token !== token || prev.userId !== userId) return true;
  return !(nowMs - prev.at < PUSH_TOKEN_REFRESH_MS && nowMs >= prev.at);
}

async function readMemo(): Promise<PushTokenMemo | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<PushTokenMemo>;
    return typeof m.token === 'string' && typeof m.userId === 'string' && typeof m.at === 'number'
      ? { token: m.token, userId: m.userId, at: m.at }
      : null;
  } catch {
    return null;
  }
}

/** Sign-out deleted this device's row: the next account must register again. */
export async function forgetPushTokenRegistration(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Best-effort.
  }
}

/** Calls `register` only when needed; throws what `register` throws (caller treats as non-fatal). */
export async function registerPushTokenIfChanged(
  token: string,
  userId: string,
  register: () => Promise<void>,
): Promise<void> {
  const now = Date.now();
  if (!needsPushTokenRegistration(await readMemo(), token, userId, now)) return;
  await register();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ token, userId, at: now } satisfies PushTokenMemo));
  } catch {
    // Best-effort: worst case we register again next launch.
  }
}
