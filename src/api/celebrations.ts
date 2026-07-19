/**
 * Achievement celebrations data access — الاحتفال بالإنجازات (V20 · §15).
 *
 * The ONE server call behind the unified celebration modal: an atomic
 * "claim this achievement" so a given event is celebrated at most once per user,
 * ever, across devices (migration 0104). The catalog of what each event means
 * lives in TypeScript (src/constants/badges.ts and the enqueue call sites), not
 * here — this module only guards the once-only rule. Components never call
 * supabase directly (CLAUDE.md); the celebration store calls this.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

/**
 * Atomically claim `eventKey`. Returns true EXACTLY ONCE (the first claim for
 * this user+key), false on every later call and on any error — so a failed claim
 * never risks showing a celebration twice. The caller enqueues the modal only on
 * true.
 *
 * Best-effort by design: a network hiccup returns false (skip the celebration)
 * rather than throwing, matching tryClaimGoalCongrats. A genuinely-earned badge is
 * still recorded server-side and will surface at رحلتي العلمية regardless.
 */
export async function tryClaimCelebration(eventKey: string): Promise<boolean> {
  if (USE_MOCK) return false;
  try {
    const { data, error } = await supabase.rpc('try_claim_celebration', {
      p_key: eventKey,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
