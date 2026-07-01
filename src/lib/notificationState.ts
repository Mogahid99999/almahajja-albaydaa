/**
 * On-device notification state (PLAN_V3 §9) — small AsyncStorage-backed values
 * the local scheduling needs but that don't belong on the server: the last app
 * open (drives the daily dead-man's-switch reset + feeds the priority
 * dispatcher), and later the per-type last-shown + bubble cap/gap state.
 *
 * Deliberately tiny and defensive: every read/write swallows errors so a storage
 * hiccup never blocks playback or notification scheduling. A reinstall resets
 * these (cosmetic, per §13).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_OPEN_KEY = 'riwaq-last-app-open';

/** Record "the app was opened just now" (ISO). Resets the daily clock. */
export async function recordAppOpen(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_OPEN_KEY, new Date().toISOString());
  } catch {
    // Non-fatal.
  }
}

/** The last recorded app-open instant (ISO), or null if never recorded. */
export async function getLastAppOpenAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_OPEN_KEY);
  } catch {
    return null;
  }
}

// --- Floating bubble cap/gap state (§6) ------------------------------------
const BUBBLE_KEY = 'riwaq-bubble-state';

/** Per-day bubble budget: count today + the last-shown epoch ms (for the gap). */
export type BubbleState = { dayKey: string; count: number; lastShownAt: number };

// LOCAL calendar day (not UTC) so the per-day bubble cap resets at the user's
// midnight, not 03:00 (or whenever UTC rolls over for their timezone).
const dayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Today's bubble state (resets at the day boundary). */
export async function getBubbleState(): Promise<BubbleState> {
  try {
    const raw = await AsyncStorage.getItem(BUBBLE_KEY);
    const s = raw ? (JSON.parse(raw) as BubbleState) : null;
    if (s && s.dayKey === dayKey()) return s;
  } catch {
    // fall through to a fresh state
  }
  return { dayKey: dayKey(), count: 0, lastShownAt: 0 };
}

/** Record that a bubble was just shown (increments today's count + gap clock). */
export async function recordBubbleShown(): Promise<void> {
  try {
    const s = await getBubbleState();
    const next: BubbleState = { dayKey: dayKey(), count: s.count + 1, lastShownAt: Date.now() };
    await AsyncStorage.setItem(BUBBLE_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal.
  }
}
