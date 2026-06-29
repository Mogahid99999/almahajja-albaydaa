/**
 * Device notification layer — a thin, defensive wrapper around expo-notifications
 * (Phase 2 · feature B). Everything in here is built to NEVER block emulator
 * testing: it no-ops on web, and in mock mode it stays entirely on-device (a fake
 * push token, locally-scheduled resume reminders) — no network, no Expo Push, no
 * Edge Function. Live push-token registration + the server fan-out are deferred
 * to the §4 cutover.
 *
 * IMPORTANT — Expo Go: expo-notifications removed push support from Expo Go with
 * SDK 53, and merely *importing* it on Android in Expo Go runs a device-push-token
 * auto-registration side-effect that throws and brings down the whole JS bundle
 * (every route loses its export → "Cannot read property 'ErrorBoundary'"). So we
 * never import it in Expo Go: the module is `require`d lazily, only where it works
 * (a real dev/standalone build, not web, not Expo Go), and otherwise no-ops. Real
 * notifications therefore need a development build — see the Expo docs link the
 * runtime error points to.
 *
 * Only the bootstrap (app/_layout.tsx), the notifications store, and the
 * save-progress seam call into here. UI components never touch expo-notifications
 * directly.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
// Types only — erased at runtime, so this never triggers the import side-effect.
import type * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { USE_MOCK } from '@/config';

/** Resume reminder fires this long after an in-progress save (pre-decided). */
export const RESUME_REMINDER_HOURS = 24;

const isWeb = Platform.OS === 'web';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Notifications only work in a real dev/standalone build — not web, not Expo Go. */
const notificationsSupported = !isWeb && !isExpoGo;

type NotificationsModule = typeof Notifications;
let _module: NotificationsModule | null | undefined;

/**
 * Lazily resolve the native module, but only where it's actually available.
 * Returns null in Expo Go / on web / if the require throws, so every caller below
 * degrades to a no-op instead of crashing.
 */
function nm(): NotificationsModule | null {
  if (!notificationsSupported) return null;
  if (_module === undefined) {
    try {
      _module = require('expo-notifications') as NotificationsModule;
    } catch {
      _module = null;
    }
  }
  return _module;
}

/** Deterministic per-lecture identifier so scheduling/cancel is stateless. */
const resumeId = (lectureId: string) => `resume-${lectureId}`;

/**
 * Whether local reminders can fire on this platform at all (real device + a build
 * where the native module exists). Callers use it to skip the pref/title lookups
 * that would otherwise run only to no-op inside scheduleResumeReminder.
 */
export function remindersSupported(): boolean {
  return Device.isDevice && nm() !== null;
}

let handlerConfigured = false;

/**
 * Foreground presentation behavior. Calm: show the banner + list entry, but no
 * sound and no app-icon badge (no count-shouting — see the inbox's single quiet
 * brass dot). Safe to call repeatedly; no-ops where notifications are unsupported.
 */
export function configureNotificationHandler(): void {
  const N = nm();
  if (!N || handlerConfigured) return;
  handlerConfigured = true;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Android needs a channel before notifications display. No-op elsewhere. */
async function ensureAndroidChannel(): Promise<void> {
  const N = nm();
  if (!N || Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync('default', {
      name: 'الإشعارات',
      importance: N.AndroidImportance.DEFAULT, // calm, not MAX
      sound: undefined,
      enableVibrate: false,
      showBadge: false,
    });
  } catch {
    // Non-fatal — scheduling still works without a custom channel.
  }
}

/**
 * Ensure notification permission, requesting it once if undetermined. Returns
 * the resolved status string ('granted' | 'denied' | 'undetermined'). No-ops to
 * 'denied' on web, on simulators, and in Expo Go, so callers never block.
 */
export async function ensurePermission(): Promise<Notifications.PermissionStatus> {
  const N = nm();
  if (!N || !Device.isDevice) {
    return 'denied' as Notifications.PermissionStatus;
  }
  await ensureAndroidChannel();
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return N.PermissionStatus.GRANTED;
    if (!current.canAskAgain) return current.status;
    const requested = await N.requestPermissionsAsync();
    return requested.status;
  } catch {
    return 'denied' as Notifications.PermissionStatus;
  }
}

/**
 * Resolve the Expo push token for this device. In mock mode we return a stable
 * fake token so the registration flow is exercised without hitting Expo's
 * servers; where notifications are unsupported we return null. Live mode fetches
 * the real token (needs the EAS projectId from app config).
 */
export async function getToken(): Promise<string | null> {
  const N = nm();
  if (!N || !Device.isDevice) return null;
  if (USE_MOCK) return 'ExponentPushToken[mock-device-token]';
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await N.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return data;
  } catch {
    return null;
  }
}

/**
 * Schedule a local "لديك درس لم تكمله" reminder for an in-progress lecture,
 * RESUME_REMINDER_HOURS from now. Idempotent: the deterministic identifier means
 * re-scheduling replaces the pending one rather than stacking. Caller gates this
 * on the `resume_reminder` pref; this fn additionally no-ops without permission.
 */
export async function scheduleResumeReminder(
  lectureId: string,
  lectureTitle: string,
): Promise<void> {
  const N = nm();
  if (!N || !Device.isDevice) return;
  try {
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    await cancelResumeReminder(lectureId); // replace any pending one
    await N.scheduleNotificationAsync({
      identifier: resumeId(lectureId),
      content: {
        title: 'لديك درس لم تكمله',
        body: lectureTitle,
        data: { lectureId } as Record<string, unknown>,
        sound: false,
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: RESUME_REMINDER_HOURS * 3600,
      },
    });
  } catch {
    // Non-fatal — a missed reminder must never break playback saves.
  }
}

/** Cancel a pending resume reminder (e.g. the lecture was completed). */
export async function cancelResumeReminder(lectureId: string): Promise<void> {
  const N = nm();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(resumeId(lectureId));
  } catch {
    // Cancelling a non-existent identifier is fine.
  }
}

/**
 * Subscribe to notification taps and deep-link via the supplied router-push.
 * `data.lectureId` → player, `data.sectionId` → section. Returns the
 * subscription's `remove`. No-op (returns a noop remover) where unsupported.
 */
export function addResponseListener(
  onDeepLink: (data: { lectureId?: string; sectionId?: string }) => void,
): () => void {
  const N = nm();
  if (!N) return () => {};
  const sub = N.addNotificationResponseReceivedListener((event) => {
    const data = (event.notification.request.content.data ?? {}) as {
      lectureId?: string;
      sectionId?: string;
    };
    onDeepLink(data);
  });
  return () => sub.remove();
}
