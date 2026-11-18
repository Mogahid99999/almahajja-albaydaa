import { create } from 'zustand';

import type { StoreUpdate } from '@/lib/storeUpdate';

/**
 * Store update prompt (2026-11-18). In memory only: «لاحقًا» hides it until the
 * app is opened again, then it asks again until the person updates.
 */
type StoreUpdateState = {
  update: StoreUpdate | null;
  dismissed: boolean;
  setUpdate: (update: StoreUpdate) => void;
  dismiss: () => void;
  /** A new opening of the app: ask again. */
  reopen: () => void;
};

export const useStoreUpdateStore = create<StoreUpdateState>((set) => ({
  update: null,
  dismissed: false,
  setUpdate: (update) => set({ update }),
  dismiss: () => set({ dismissed: true }),
  reopen: () => set({ dismissed: false }),
}));

/** True while the update prompt is (or is about to be) on screen — other popups wait. */
export function storeUpdatePromptPending(): boolean {
  const { update, dismissed } = useStoreUpdateStore.getState();
  return !!update?.available && !dismissed;
}
