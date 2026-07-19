/**
 * Celebration cue — the sound + light haptic for the achievement modal
 * (V20 · §15; decision 2026-07-19: use the NORMAL system notification sound, ON).
 *
 * Plays the device's DEFAULT notification tone (no bundled asset needed) and a
 * light haptic. Best-effort and dependency-optional so it never throws into the
 * render path and never forces a native build:
 *  - haptic via `expo-haptics` IF installed (dynamic require → no-op otherwise);
 *  - sound via expo-audio (already a dependency) pointed at the OS notification
 *    sound. On Android that's the `content://…/notification_sound` system URI; on
 *    iOS there's no public default-tone URI, so the sound is simply skipped (the
 *    haptic still fires) rather than shipping a custom file.
 *
 * `reduceMotion` suppresses the haptic; the sound stays (a short tone is the point).
 * To enable the haptic for real: `npx expo install expo-haptics`.
 */
import { Platform } from 'react-native';

import type { CelebrationLevel } from '@/api/types';

/** The Android system default notification sound (a content:// URI, playable). */
const ANDROID_NOTIFICATION_SOUND =
  'content://settings/system/notification_sound';

/** Play the cue for a celebration of the given weight. Never throws. */
export async function playCelebrationCue(
  level: CelebrationLevel,
  reduceMotion: boolean,
): Promise<void> {
  try {
    if (!reduceMotion) await lightHaptic(level);
  } catch {
    /* haptics unavailable — ignore */
  }
  try {
    await notificationTone();
  } catch {
    /* sound unavailable — ignore */
  }
}

/** A gentle haptic, weight-scaled; no-op when expo-haptics isn't installed. */
async function lightHaptic(level: CelebrationLevel): Promise<void> {
  // `any` + a string require so the bundler/TS don't hard-depend on a package
  // that may be absent; the try/catch in the caller covers a missing module.
  let Haptics: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    Haptics = require('expo-haptics');
  } catch {
    return;
  }
  if (!Haptics?.impactAsync) return;
  const style =
    level === 'large'
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light;
  await Haptics.impactAsync(style);
}

/**
 * Play the device's default notification tone once via expo-audio's low-level
 * player (already a dependency, patched for lectures) — so no new module or asset
 * is needed. Android points at the system notification-sound URI; other platforms
 * have no public default-tone URI, so this no-ops there. Fully torn down after it
 * finishes so it never holds the audio session away from lecture playback.
 */
async function notificationTone(): Promise<void> {
  if (Platform.OS !== 'android') return; // no public default-tone URI elsewhere

  let mod: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    mod = require('expo-audio');
  } catch {
    return;
  }
  if (!mod?.createAudioPlayer) return;

  const player = mod.createAudioPlayer({ uri: ANDROID_NOTIFICATION_SOUND });
  try {
    player.volume = 0.7;
    player.play();
    // The tone is short (~1–2s). Release shortly after so we don't leak the
    // player or hold audio focus away from any lecture that was playing.
    setTimeout(() => {
      try {
        player.remove();
      } catch {
        /* already gone */
      }
    }, 3000);
  } catch {
    try {
      player.remove();
    } catch {
      /* ignore */
    }
  }
}
