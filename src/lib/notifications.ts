/**
 * Device notification layer — a thin, defensive wrapper around expo-notifications
 * (Phase 2 · feature B). Everything in here is built to NEVER block emulator
 * testing: it no-ops on web, and in mock mode it stays entirely on-device (a fake
 * push token, locally-scheduled resume reminders) — no network, no Expo Push, no
 * Edge Function. Live push-token registration + the server fan-out are deferred
 * to the §4 cutover.
 *
 * Only the bootstrap (app/_layout.tsx), the notifications store, and the
 * save-progress seam call into here. UI components never touch expo-notifications
 * directly.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { USE_MOCK } from '@/config';

/** Resume reminder fires this long after an in-progress save (pre-decided). */
export const RESUME_REMINDER_HOURS = 24;

const isWeb = Platform.OS === 'web';

/** Deterministic per-lecture identifier so scheduling/cancel is stateless. */
const resumeId = (lectureId: string) => `resume-${lectureId}`;

/**
 * Whether local reminders can fire on this platform at all (real device, not
 * web). Callers use it to skip the pref/title lookups that would otherwise run
 * on web / simulator only to no-op inside scheduleResumeReminder.
 */
export function remindersSupported(): boolean {
  return !isWeb && Device.isDevice;
}

let handlerConfigured = false;

/**
 * Foreground presentation behavior. Calm: show the banner + list entry, but no
 * sound and no app-icon badge (no count-shouting — see the inbox's single quiet
 * brass dot). Safe to call repeatedly; no-ops on web.
 */
export function configureNotificationHandler(): void {
  if (isWeb || handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
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
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'الإشعارات',
      importance: Notifications.AndroidImportance.DEFAULT, // calm, not MAX
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
 * 'denied' on web and on simulators (no real device), so callers never block.
 */
export async function ensurePermission(): Promise<Notifications.PermissionStatus> {
  if (isWeb || !Device.isDevice) {
    return Notifications.PermissionStatus.DENIED;
  }
  await ensureAndroidChannel();
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return Notifications.PermissionStatus.GRANTED;
    if (!current.canAskAgain) return current.status;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.status;
  } catch {
    return Notifications.PermissionStatus.DENIED;
  }
}

/**
 * Resolve the Expo push token for this device. In mock mode we return a stable
 * fake token so the registration flow is exercised without hitting Expo's
 * servers; on web / non-devices we return null. Live mode fetches the real token
 * (needs the EAS projectId from app config).
 */
export async function getToken(): Promise<string | null> {
  if (isWeb || !Device.isDevice) return null;
  if (USE_MOCK) return 'ExponentPushToken[mock-device-token]';
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(
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
  if (isWeb || !Device.isDevice) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await cancelResumeReminder(lectureId); // replace any pending one
    await Notifications.scheduleNotificationAsync({
      identifier: resumeId(lectureId),
      content: {
        title: 'لديك درس لم تكمله',
        body: lectureTitle,
        data: { lectureId } as Record<string, unknown>,
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: RESUME_REMINDER_HOURS * 3600,
      },
    });
  } catch {
    // Non-fatal — a missed reminder must never break playback saves.
  }
}

/** Cancel a pending resume reminder (e.g. the lecture was completed). */
export async function cancelResumeReminder(lectureId: string): Promise<void> {
  if (isWeb) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(resumeId(lectureId));
  } catch {
    // Cancelling a non-existent identifier is fine.
  }
}

/**
 * Subscribe to notification taps and deep-link via the supplied router-push.
 * `data.lectureId` → player, `data.sectionId` → section. Returns the
 * subscription's `remove`. No-op (returns a noop remover) on web.
 */
export function addResponseListener(
  onDeepLink: (data: { lectureId?: string; sectionId?: string }) => void,
): () => void {
  if (isWeb) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((event) => {
    const data = (event.notification.request.content.data ?? {}) as {
      lectureId?: string;
      sectionId?: string;
    };
    onDeepLink(data);
  });
  return () => sub.remove();
}
