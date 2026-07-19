import { create } from 'zustand';

import { tryClaimCelebration } from '@/api/celebrations';
import type { CelebrationEvent } from '@/api/types';

/**
 * Celebration queue — الاحتفال بالإنجازات (V20 · §15).
 *
 * A tiny in-memory FIFO the whole app pushes achievements into; the mounted
 * <AchievementCelebration> at the root shows them ONE AT A TIME in sequence
 * (§15 "تُجمع الإنجازات المتزامنة في نافذة واحدة بالتتابع"). Not persisted — the
 * server (`try_claim_celebration`, migration 0104) is the source of truth for
 * "already celebrated", so a restart never re-shows a claimed event, and an
 * unclaimed one that got dropped by a crash simply resurfaces at رحلتي العلمية.
 *
 * `suppressed` is the quiz gate (§15 "لا يظهر قبل إعلان نتيجة الاختبار"): the
 * quiz-attempt screen raises it on mount and lowers it when the result is shown,
 * so a badge earned mid-quiz waits its turn instead of covering the questions.
 * Enqueue still works while suppressed — items just don't become `current` until
 * it clears.
 */
type CelebrationState = {
  /** Pending events not yet shown (excludes the one currently on screen). */
  queue: CelebrationEvent[];
  /** The event currently displayed, or null when idle. */
  current: CelebrationEvent | null;
  /** While true, nothing is promoted to `current` (quiz in progress). */
  suppressed: boolean;

  /**
   * Claim + enqueue an achievement. Awaits the server claim so a given event
   * fires at most once per user across devices; a lost race (false) is a no-op.
   * De-dupes within the session too (same key already queued/current is ignored)
   * so a double completion tick can't double-enqueue before the claim resolves.
   */
  celebrate: (event: CelebrationEvent) => Promise<void>;
  /** Enqueue WITHOUT a server claim — for events already claimed by the caller. */
  enqueueClaimed: (event: CelebrationEvent) => void;
  /** Dismiss the current event and promote the next (if any, and not suppressed). */
  dismissCurrent: () => void;
  /** Quiz gate: pause/resume promotion of queued events. */
  setSuppressed: (suppressed: boolean) => void;
};

export const useCelebrationStore = create<CelebrationState>((set, get) => {
  /** Promote the head of the queue to `current` when idle and not suppressed. */
  const pump = () => {
    const s = get();
    if (s.current || s.suppressed || s.queue.length === 0) return;
    const [next, ...rest] = s.queue;
    set({ current: next, queue: rest });
  };

  const has = (key: string) => {
    const s = get();
    return s.current?.key === key || s.queue.some((e) => e.key === key);
  };

  return {
    queue: [],
    current: null,
    suppressed: false,

    celebrate: async (event) => {
      if (has(event.key)) return; // already in-flight this session
      const claimed = await tryClaimCelebration(event.key);
      if (!claimed) return; // someone/somewhere already celebrated it
      if (has(event.key)) return; // re-check: could have been enqueued while awaiting
      set((s) => ({ queue: [...s.queue, event] }));
      pump();
    },

    enqueueClaimed: (event) => {
      if (has(event.key)) return;
      set((s) => ({ queue: [...s.queue, event] }));
      pump();
    },

    dismissCurrent: () => {
      set({ current: null });
      pump();
    },

    setSuppressed: (suppressed) => {
      set({ suppressed });
      if (!suppressed) pump();
    },
  };
});

/** Imperative helper for non-React call sites (e.g. the audio controller). */
export const celebrate = (event: CelebrationEvent): Promise<void> =>
  useCelebrationStore.getState().celebrate(event);
