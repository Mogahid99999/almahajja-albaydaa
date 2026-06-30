import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Small device-level playback preferences. Persisted with AsyncStorage (works on
 * native + web) so the choice survives app restarts — unlike the in-memory
 * player/downloads stores. Read by the audio controller; toggled in the profile.
 */
type SettingsState = {
  /** Auto-play the next lecture in the section when one finishes (PRD §8). */
  autoAdvance: boolean;
  setAutoAdvance: (autoAdvance: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoAdvance: true,
      setAutoAdvance: (autoAdvance) => set({ autoAdvance }),
    }),
    {
      name: 'riwaq-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
