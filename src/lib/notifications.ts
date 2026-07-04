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

import { NOTIF_TEST_MODE, USE_MOCK } from '@/config';
import { arNum } from './format';
import { pickPhrase } from './notificationPhrases';

/** First resume nudge (general / near-completion bank) fires this long after a pause. */
export const RESUME_T1_HOURS = 6;
/** "Still unfinished after a long gap" (>3 days) variant — its own delayed reminder. */
export const RESUME_LONGGAP_HOURS = 72;
/** Soft no-shame non-completion fallback, after the resume attempts have been ignored. */
export const RESUME_NONCOMPLETION_HOURS = 168;
/** Above this listened fraction the near-completion bank (1b) is used instead of general. */
export const NEAR_COMPLETION_PCT = 0.7;
/**
 * "Continue the series" reminder base offset. Staggered off the daily (24h) so
 * the two don't coincide; the random spread separates them further.
 */
export const SERIES_REMINDER_HOURS = 16;
/**
 * Daily remembrance "dead-man's switch": re-armed this far out on every app
 * open, so it fires only after ~a day of NO opens, then once per day while the
 * app stays unopened (the repeating interval), and an open resets the clock.
 */
export const DAILY_REMINDER_INTERVAL_HOURS = 24;

/**
 * Production-only random spread (0…this) added to every reminder so multiple
 * reminders never land at the same instant — they trickle in at intervals
 * through the day rather than all at once (user direction). No jitter in test
 * mode (keeps the device checks fast + deterministic).
 */
const SPREAD_SECONDS = 6 * 3600; // up to +6h

/**
 * Effective trigger delay: the short `testSeconds` stand-in in NOTIF_TEST_MODE
 * (so each rung can be observed quickly on-device, §15), otherwise the real
 * `hours` value plus a random spread so reminders don't bunch. Never ship with
 * NOTIF_TEST_MODE on.
 */
const delaySeconds = (hours: number, testSeconds: number): number =>
  NOTIF_TEST_MODE
    ? testSeconds
    : Math.round(hours * 3600 + Math.random() * SPREAD_SECONDS);

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

/** Deterministic per-lecture identifiers so scheduling/cancel is stateless. */
const resumeId = (lectureId: string) => `resume-${lectureId}`;
/** The >3-day "long gap, still unfinished" variant (its own delayed reminder). */
const resumeLongGapId = (lectureId: string) => `resume-longgap-${lectureId}`;
/** The soft no-shame non-completion fallback (latest in the ladder). */
const noncompletionId = (lectureId: string) => `resume-noncomp-${lectureId}`;
/** Deterministic per-section identifier for the "continue the series" reminder. */
const seriesId = (sectionId: string) => `series-${sectionId}`;
/** Single shared identifier for the opt-in daily remembrance. */
const DAILY_REMINDER_ID = 'daily-reminder';

/**
 * Android notification channel. Android 8+ locks a channel's importance + sound
 * at creation — later edits are IGNORED — so making the once-silent reminders
 * gently audible requires a NEW channel id (the old 'default' stays silent for
 * anyone who never upgrades). 'default-v2' is importance HIGH with the default
 * system sound and NO vibration (calm §14, softened per the audible-sound
 * decision). Every scheduled/immediate notification routes here via `channelId`.
 */
const AUDIBLE_CHANNEL_ID = 'default-v2';

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
 * Foreground presentation behavior. Calm: show the banner + list entry, no
 * sound. `shouldSetBadge` is ON so a new-lesson push carries its unread count to
 * the launcher icon (Issue 8); the count is cleared when the app is opened.
 * Safe to call repeatedly; no-ops where notifications are unsupported.
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
      shouldSetBadge: true,
    }),
  });
}

/**
 * Clear the launcher app-icon badge (Issue 8) — called when the app is opened /
 * foregrounded, so the "new lessons" count resets once the student is in. On
 * One UI (the Samsung test device) this drops the numeric badge; some launchers
 * only show a dot. No-ops where notifications are unsupported.
 */
export async function clearBadge(): Promise<void> {
  const N = nm();
  if (!N) return;
  try {
    await N.setBadgeCountAsync(0);
  } catch {
    // Non-fatal — a stuck badge must never block the app.
  }
}

/**
 * Android needs a channel before notifications display. We create 'default-v2' —
 * importance HIGH + default system sound so reminders are gently audible when the
 * app is backgrounded — with vibration OFF to keep it calm. A new id is required
 * because Android ignores importance/sound changes to an already-created channel.
 * No-op off Android.
 */
async function ensureAndroidChannel(): Promise<void> {
  const N = nm();
  if (!N || Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync(AUDIBLE_CHANNEL_ID, {
      name: 'الإشعارات',
      importance: N.AndroidImportance.HIGH, // audible + heads-up, but calm below
      sound: 'default', // gentle default system sound (was silent)
      enableVibrate: false, // no aggressive vibration
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
 * Schedule the gentle resume "ladder" for an in-progress lecture (§2 1a/1b/1c +
 * #3). Each rung is its own delayed reminder with wording fixed at schedule time
 * (you can't "upgrade" a pending notification's text), all carrying the paused
 * position for deep-link-at-second:
 *   1) +T1 (6h)  — general (≤70%) OR near-completion (>70%) bank.
 *   2) +3 days   — long-gap "still unfinished" bank.
 *   3) +7 days   — soft no-shame non-completion fallback (own pref).
 * Deterministic ids → re-scheduling on the next save (or on resume) replaces the
 * whole ladder rather than stacking, and {@link cancelResumeReminder} clears all
 * three on completion. Caller gates the first two on `resume_reminder`; the
 * fallback is gated here on `noncompletionEnabled`. No-ops without permission.
 */
export async function scheduleResumeReminders(args: {
  lectureId: string;
  lectureTitle: string;
  positionSec: number;
  durationSec: number;
  /** `noncompletion_gentle` pref — schedules the +7d soft fallback when ON. */
  noncompletionEnabled: boolean;
}): Promise<void> {
  const N = nm();
  if (!N || !Device.isDevice) return;
  try {
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    await cancelResumeReminder(args.lectureId); // replace the whole pending ladder

    const { lectureId, lectureTitle, positionSec, durationSec } = args;
    const near = durationSec > 0 && positionSec / durationSec > NEAR_COMPLETION_PCT;
    // Carried on every rung so a tap opens the player at the exact paused second.
    const data = {
      lectureId,
      positionSec: Math.max(0, Math.round(positionSec)),
      pausedAt: new Date().toISOString(),
    } as Record<string, unknown>;

    // 1) First nudge — near-completion or general bank, +T1.
    await N.scheduleNotificationAsync({
      identifier: resumeId(lectureId),
      content: {
        title: await pickPhrase(near ? 'resume_near' : 'resume_general'),
        body: lectureTitle,
        data,
        sound: 'default',
      },
      trigger: {
        channelId: AUDIBLE_CHANNEL_ID,
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds(RESUME_T1_HOURS, 60),
      },
    });

    // 2) Long-gap — still unfinished after >3 days.
    await N.scheduleNotificationAsync({
      identifier: resumeLongGapId(lectureId),
      content: {
        title: await pickPhrase('resume_longgap'),
        body: lectureTitle,
        data,
        sound: 'default',
      },
      trigger: {
        channelId: AUDIBLE_CHANNEL_ID,
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds(RESUME_LONGGAP_HOURS, 150),
      },
    });

    // 3) Non-completion gentle — soft no-shame fallback (own pref).
    if (args.noncompletionEnabled) {
      await N.scheduleNotificationAsync({
        identifier: noncompletionId(lectureId),
        content: {
          title: await pickPhrase('noncompletion'),
          body: lectureTitle,
          data,
          sound: 'default',
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: delaySeconds(RESUME_NONCOMPLETION_HOURS, 210),
        },
      });
    }
  } catch {
    // Non-fatal — a missed reminder must never break playback saves.
  }
}

/**
 * Present an immediate calm "أكملت الدرس، نفعك الله بما سمعت" encouragement when
 * a lesson crosses the completion threshold (PRD §20). No identifier (one-shot,
 * never replaced/cancelled); body = the lecture title. Caller gates on the
 * `completion_praise` pref; no-ops without permission.
 */
export async function presentCompletionPraise(lectureTitle: string): Promise<void> {
  const N = nm();
  if (!N || !Device.isDevice) return;
  try {
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    await N.scheduleNotificationAsync({
      content: {
        title: await pickPhrase('completion'),
        body: lectureTitle,
        sound: 'default',
      },
      // Immediate, but routed to the audible channel (Android sound lives on the
      // channel, so a null trigger would fall back to the default/silent one).
      trigger: { channelId: AUDIBLE_CHANNEL_ID },
    });
  } catch {
    // Non-fatal — a missed encouragement must never break playback saves.
  }
}

/**
 * Present an immediate calm "أكملت هدفك هذا الأسبوع…" when the student crosses
 * their weekly goal (the crossing happens while the app is open, so this is
 * local — the time-based midweek/2-days nudges are server cron-push instead).
 * Deep-links to رحلتي العلمية. Caller gates on the `weekly_goal` pref + the
 * once-per-week claim; no-ops without permission.
 */
export async function presentGoalCongrats(): Promise<void> {
  const N = nm();
  if (!N || !Device.isDevice) return;
  try {
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    await N.scheduleNotificationAsync({
      content: {
        title: await pickPhrase('goal_done'),
        sound: 'default',
        data: { route: '/(student)/journey' } as Record<string, unknown>,
      },
      // Immediate on the audible channel (see completion praise above).
      trigger: { channelId: AUDIBLE_CHANNEL_ID },
    });
  } catch {
    // Non-fatal.
  }
}

/**
 * Schedule a gentle "continue the series you started" reminder for a started-
 * but-unfinished section, SERIES_REMINDER_HOURS from now. Uses the §11 series
 * bank, interpolating the section name `[اسم السلسلة]` and the remaining lesson
 * count `[عدد]` (Arabic-Indic). Deep-links to the section page. Deterministic
 * per-section identifier → re-scheduling replaces rather than stacks. Caller
 * gates on `resume_series` + remaining > 0; no-ops without permission.
 */
export async function scheduleSeriesReminder(
  sectionId: string,
  sectionTitle: string,
  remaining: number,
): Promise<void> {
  const N = nm();
  if (!N || !Device.isDevice) return;
  try {
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    await cancelSeriesReminder(sectionId); // replace any pending one
    await N.scheduleNotificationAsync({
      identifier: seriesId(sectionId),
      content: {
        title: await pickPhrase('series', {
          '[اسم السلسلة]': sectionTitle,
          '[عدد]': arNum(remaining),
        }),
        body: sectionTitle,
        data: { sectionId } as Record<string, unknown>,
        sound: 'default',
      },
      trigger: {
        channelId: AUDIBLE_CHANNEL_ID,
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds(SERIES_REMINDER_HOURS, 90),
      },
    });
  } catch {
    // Non-fatal.
  }
}

/** Cancel a pending series reminder (e.g. the section was finished). */
export async function cancelSeriesReminder(sectionId: string): Promise<void> {
  const N = nm();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(seriesId(sectionId));
  } catch {
    // Cancelling a non-existent identifier is fine.
  }
}

/**
 * (Re)arm the opt-in daily remembrance as a "dead-man's switch": a repeating
 * 24h interval. The OS repeats it even when the app is closed, so it fires once
 * per day while the app stays unopened, indefinitely. Re-armed (cancel + fresh
 * schedule, new round-robin phrase) on every app→foreground, which RESETS the
 * 24h clock — so it never fires while the student keeps opening the app, and an
 * open suppresses the next day's fire. Off by default (the prefs toggle / the
 * foreground re-arm turn it on). Silent (no sound/vibration) → inherently
 * undisturbing during quiet hours. Idempotent; no-ops without permission.
 */
export async function scheduleDailyReminder(): Promise<void> {
  const N = nm();
  if (!N || !Device.isDevice) return;
  try {
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    await cancelDailyReminder(); // replace any pending one (resets the clock)
    await N.scheduleNotificationAsync({
      identifier: DAILY_REMINDER_ID,
      content: {
        title: await pickPhrase('daily'),
        sound: 'default',
        data: { daily: true } as Record<string, unknown>,
      },
      trigger: {
        channelId: AUDIBLE_CHANNEL_ID,
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds(DAILY_REMINDER_INTERVAL_HOURS, 110),
        repeats: true,
      },
    });
  } catch {
    // Non-fatal.
  }
}

/** Cancel the opt-in daily remembrance (the prefs toggle was turned off). */
export async function cancelDailyReminder(): Promise<void> {
  const N = nm();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch {
    // Cancelling a non-existent identifier is fine.
  }
}

/**
 * Cancel the whole pending resume ladder for a lecture (first nudge, long-gap,
 * and the non-completion fallback) — e.g. the lecture was completed, or the
 * student resumed it (the next save reschedules a fresh ladder).
 */
export async function cancelResumeReminder(lectureId: string): Promise<void> {
  const N = nm();
  if (!N) return;
  for (const id of [resumeId(lectureId), resumeLongGapId(lectureId), noncompletionId(lectureId)]) {
    try {
      await N.cancelScheduledNotificationAsync(id);
    } catch {
      // Cancelling a non-existent identifier is fine.
    }
  }
}

/**
 * Subscribe to notification taps and deep-link via the supplied router-push.
 * `data.lectureId` → player, `data.sectionId` → section. Returns the
 * subscription's `remove`. No-op (returns a noop remover) where unsupported.
 */
export function addResponseListener(
  onDeepLink: (data: {
    lectureId?: string;
    sectionId?: string;
    positionSec?: number;
    route?: string;
  }) => void,
): () => void {
  const N = nm();
  if (!N) return () => {};
  const sub = N.addNotificationResponseReceivedListener((event) => {
    const data = (event.notification.request.content.data ?? {}) as {
      lectureId?: string;
      sectionId?: string;
      positionSec?: number;
      route?: string;
    };
    onDeepLink(data);
  });
  return () => sub.remove();
}

/**
 * Cold-start deep-link: the tap that LAUNCHES the app from a killed state is
 * delivered before the response listener mounts, so addResponseListener misses
 * it. Read the last response once on boot and return its deep-link payload (or
 * null). Safe everywhere — no-ops where notifications are unsupported.
 */
export async function getInitialDeepLink(): Promise<
  { lectureId?: string; sectionId?: string; positionSec?: number; route?: string } | null
> {
  const N = nm();
  if (!N) return null;
  try {
    const response = await N.getLastNotificationResponseAsync();
    if (!response) return null;
    return (response.notification.request.content.data ?? {}) as {
      lectureId?: string;
      sectionId?: string;
      positionSec?: number;
      route?: string;
    };
  } catch {
    return null;
  }
}
