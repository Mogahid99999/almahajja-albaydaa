/**
 * Cumulative-foreground-time tracking for the star-rating prompt. Sums
 * foreground seconds across sessions (not one continuous session): first
 * prompt at 2h total, then re-prompts every +20h if dismissed, until the
 * user actually rates — then never again. Local-only (AsyncStorage), same
 * defensive style as src/lib/notificationState.ts: every read/write swallows
 * errors so a storage hiccup never blocks anything else.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const USAGE_SECONDS_KEY = 'riwaq-usage-seconds';
const NEXT_PROMPT_AT_KEY = 'riwaq-usage-next-prompt-at';
const HAS_RATED_KEY = 'riwaq-has-rated';

const FIRST_PROMPT_SECONDS = 2 * 3600;
const REPROMPT_GAP_SECONDS = 20 * 3600;

async function getNumber(key: string, fallback: number): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Add elapsed foreground seconds from the just-ended session to the running total. */
export async function addForegroundSeconds(seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    const total = await getNumber(USAGE_SECONDS_KEY, 0);
    await AsyncStorage.setItem(USAGE_SECONDS_KEY, String(total + seconds));
  } catch {
    // Non-fatal.
  }
}

/** Whether the rating modal should be shown right now. */
export async function shouldShowRatingPrompt(): Promise<boolean> {
  try {
    const rated = await AsyncStorage.getItem(HAS_RATED_KEY);
    if (rated === 'true') return false;
    const total = await getNumber(USAGE_SECONDS_KEY, 0);
    const nextAt = await getNumber(NEXT_PROMPT_AT_KEY, FIRST_PROMPT_SECONDS);
    return total >= nextAt;
  } catch {
    return false;
  }
}

/** User dismissed the prompt via cancel — push the next prompt out by 20h. */
export async function deferRatingPrompt(): Promise<void> {
  try {
    const nextAt = await getNumber(NEXT_PROMPT_AT_KEY, FIRST_PROMPT_SECONDS);
    await AsyncStorage.setItem(NEXT_PROMPT_AT_KEY, String(nextAt + REPROMPT_GAP_SECONDS));
  } catch {
    // Non-fatal.
  }
}

/** User submitted a rating — never show the prompt again. */
export async function markRatingSubmitted(): Promise<void> {
  try {
    await AsyncStorage.setItem(HAS_RATED_KEY, 'true');
  } catch {
    // Non-fatal.
  }
}

/** Whether the user has already rated (used to hide the profile "rate" row). */
export async function hasRated(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HAS_RATED_KEY)) === 'true';
  } catch {
    return false;
  }
}
