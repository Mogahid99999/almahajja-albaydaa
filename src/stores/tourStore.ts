import { create } from 'zustand';

/**
 * Ephemeral first-time "How it works" tour state (see TourCard + tourSteps).
 * Started once right after a fresh registration (useRegister's onSuccess) or
 * manually from الحساب → إعادة عرض الجولة التعريفية. Deliberately in-memory
 * only, no persistence — a force-quit mid-tour simply ends it rather than
 * resuming, kept intentionally simple.
 */
type TourState = {
  isActive: boolean;
  stepIndex: number;
  sectionId: string | null;
  lectureId: string | null;
  /**
   * Registration tours only (useRegister passes it; the الحساب replay doesn't):
   * when THIS tour ends — finished or skipped — recommend the «ابدأ من هنا»
   * lecture right after (StartHereCard).
   */
  suggestStartHere: boolean;
  /** The post-tour «ابدأ من هنا» recommendation popup should be showing now. */
  startHereVisible: boolean;
};

type TourActions = {
  start: (
    ctx: { sectionId: string | null; lectureId: string | null },
    opts?: { suggestStartHere?: boolean },
  ) => void;
  next: () => void;
  reset: () => void;
  dismissStartHere: () => void;
};

const initial: TourState = {
  isActive: false,
  stepIndex: 0,
  sectionId: null,
  lectureId: null,
  suggestStartHere: false,
  startHereVisible: false,
};

export const useTourStore = create<TourState & TourActions>((set) => ({
  ...initial,
  start: (ctx, opts) =>
    set({
      isActive: true,
      stepIndex: 0,
      suggestStartHere: opts?.suggestStartHere ?? false,
      startHereVisible: false,
      ...ctx,
    }),
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  // reset() is how TourCard ends a tour (finish AND skip), so the pending
  // recommendation hands off here: the flag consumes itself into visibility.
  reset: () => set((s) => ({ ...initial, startHereVisible: s.suggestStartHere })),
  dismissStartHere: () => set({ startHereVisible: false }),
}));
