/**
 * Expo Router native intents (PLAN_LIVE_V23 §9.3, D8).
 *
 * The public share link is https://go.almahajja.app/live/{share_code} (Android
 * App Links / iOS Universal Links — app.json), but the app route for a code is
 * app/live/code/[code].tsx: /live/{x} is the ROOM by session id. So a system
 * link https://go.almahajja.app/live/<code> — or riwaqalilm://live/<code> — is
 * rewritten to /live/code/<code>. /live/<uuid>, /live/green/<uuid>,
 * /live/code/<code> and every other link pass through unchanged
 * (liveSystemPath, unit-tested in src/components/live/__tests__/liveLinks.test.ts).
 *
 * Must never throw (expo-router: a throw here can crash the app on launch).
 */
import { liveSystemPath } from '@/components/live/liveUi';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return liveSystemPath(path);
  } catch {
    return path;
  }
}
