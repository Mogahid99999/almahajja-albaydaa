/**
 * Floating-bubble overlay — JS policy + native bridge (PLAN_V3 Phase 9).
 *
 * EXPERIMENTAL, Android-only, OFF by default (`BUBBLE_ENABLED`). The actual
 * "draw over other apps" window + the ACTION_USER_PRESENT (unlock) detection
 * live in a native module (`native/floating-bubble`, an Expo module) that must
 * be activated via `expo prebuild` and granted SYSTEM_ALERT_WINDOW. Until that
 * module is linked, `requireOptionalNativeModule` returns null and EVERYTHING
 * here gracefully no-ops — so this file is safe to ship dormant.
 *
 * This module owns the *policy*: ≤3/day, ≥2h gap, and "defer don't fall back"
 * (quiet hours were dropped). The native module owns the *window* + usage trigger;
 * it calls `maybeShowResumeBubble` on a real usage moment (USER_PRESENT / app→fg
 * while a resume target exists), and we decide whether to actually surface it.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { BUBBLE_ENABLED, NOTIF_TEST_MODE } from '@/config';
import { getBubbleState, recordBubbleShown } from './notificationState';

// Quiet hours were intentionally DROPPED per user direction — the bubble may
// surface at any hour; only the per-day cap + gap throttle it.
/** At most this many bubbles per day, with at least this gap between them. */
const MAX_PER_DAY = 3;
const MIN_GAP_MS = NOTIF_TEST_MODE ? 0 : 2 * 60 * 60 * 1000;

/** Shape of the native overlay module (null until linked). */
type FloatingBubbleModule = {
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<void>;
  show(payload: { lessonId: string; positionSec: number; text: string }): Promise<void>;
  hide(): Promise<void>;
  addListener(event: string, listener: (...args: unknown[]) => void): { remove(): void };
};

let _mod: FloatingBubbleModule | null | undefined;
function native(): FloatingBubbleModule | null {
  if (Platform.OS !== 'android' || !BUBBLE_ENABLED) return null;
  if (_mod === undefined) {
    _mod = requireOptionalNativeModule<FloatingBubbleModule>('FloatingBubble') ?? null;
  }
  return _mod;
}

/** Whether the native overlay is available (flag on + module linked + Android). */
export function bubbleSupported(): boolean {
  return native() !== null;
}

/** Whether SYSTEM_ALERT_WINDOW (draw-over-other-apps) is granted. */
export async function hasOverlayPermission(): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return await m.hasPermission();
  } catch {
    return false;
  }
}

/** Open the system overlay-permission settings (cannot be silently granted). */
export async function requestOverlayPermission(): Promise<void> {
  const m = native();
  if (!m) return;
  try {
    await m.requestPermission();
  } catch {
    // Non-fatal.
  }
}

/**
 * Cheap, target-free eligibility pre-check (consent + permission + ≤3/day + ≥2h
 * gap) so the usage handler only fetches a resume target when a bubble could
 * actually show. (Quiet hours were dropped per user direction.)
 */
export async function bubbleEligibleNow(consentOn: boolean): Promise<boolean> {
  const m = native();
  if (!m || !consentOn) return false;
  if (!(await hasOverlayPermission())) return false;
  const s = await getBubbleState();
  if (s.count >= MAX_PER_DAY) return false;
  if (Date.now() - s.lastShownAt < MIN_GAP_MS) return false;
  return true;
}

/**
 * Surface a resume bubble if every gate passes (eligibility + a resume target).
 * Returns true if shown. No-ops (false) until the native module is linked.
 * "Defer, don't fall back": when a usage trigger arrives while ineligible we
 * simply don't show — the next eligible usage moment re-asks; we never convert
 * it to a system notification.
 */
export async function maybeShowResumeBubble(opts: {
  consentOn: boolean;
  lessonId: string;
  positionSec: number;
  /** The calm resume phrase to display (picked by the resume-ladder variant). */
  text: string;
}): Promise<boolean> {
  const m = native();
  if (!m) return false;
  if (!(await bubbleEligibleNow(opts.consentOn))) return false;

  try {
    await m.show({
      lessonId: opts.lessonId,
      positionSec: Math.max(0, Math.round(opts.positionSec)),
      text: opts.text,
    });
    await recordBubbleShown();
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to the native usage trigger (`onUserPresent`, fired on unlock) and
 * the bubble tap (`onBubbleTap`, carrying lessonId + positionSec). Returns an
 * unsubscribe. No-ops (returns a noop) until the native module is linked.
 */
export function addBubbleListeners(handlers: {
  onUserPresent: () => void;
  onBubbleTap: (data: { lessonId?: string; positionSec?: number }) => void;
}): () => void {
  const m = native();
  if (!m) return () => {};
  const subs = [
    m.addListener('onUserPresent', () => handlers.onUserPresent()),
    m.addListener('onBubbleTap', (payload) =>
      handlers.onBubbleTap((payload ?? {}) as { lessonId?: string; positionSec?: number }),
    ),
  ];
  return () => subs.forEach((s) => s.remove());
}
