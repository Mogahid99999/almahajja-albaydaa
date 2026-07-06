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
};

type TourActions = {
  start: (ctx: { sectionId: string | null; lectureId: string | null }) => void;
  next: () => void;
  reset: () => void;
};

const initial: TourState = {
  isActive: false,
  stepIndex: 0,
  sectionId: null,
  lectureId: null,
};

export const useTourStore = create<TourState & TourActions>((set) => ({
  ...initial,
  start: (ctx) => set({ isActive: true, stepIndex: 0, ...ctx }),
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  reset: () => set(initial),
}));
