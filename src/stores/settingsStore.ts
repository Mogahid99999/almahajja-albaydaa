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
  /**
   * Master consent for the floating-bubble overlay (Phase 9). ON by default so
   * the feature works out of the box; the student can turn it off, and it still
   * needs the SYSTEM_ALERT_WINDOW grant. Read by the bubble bootstrap in
   * app/_layout.
   */
  bubbleConsent: boolean;
  setBubbleConsent: (bubbleConsent: boolean) => void;
  /**
   * Whether the guest has dismissed the gentle "register to track your progress"
   * Home banner (Task 3). Persisted so a dismissed banner stays gone; irrelevant
   * once the user registers (the banner only shows for guests).
   */
  guestBannerDismissed: boolean;
  setGuestBannerDismissed: (guestBannerDismissed: boolean) => void;
  /**
   * Whether the post-reinstall "restore your downloads" prompt has already been
   * offered on THIS install (V19). Persisted in AsyncStorage — which uninstall
   * wipes along with the manifest — so a genuine reinstall gets a fresh offer,
   * while a normal relaunch doesn't nag. Set once the prompt is shown (accepted
   * OR dismissed); the manual button on the downloads page stays available
   * regardless.
   */
  restorePromptSeen: boolean;
  setRestorePromptSeen: (restorePromptSeen: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoAdvance: true,
      setAutoAdvance: (autoAdvance) => set({ autoAdvance }),
      bubbleConsent: true,
      setBubbleConsent: (bubbleConsent) => set({ bubbleConsent }),
      guestBannerDismissed: false,
      setGuestBannerDismissed: (guestBannerDismissed) => set({ guestBannerDismissed }),
      restorePromptSeen: false,
      setRestorePromptSeen: (restorePromptSeen) => set({ restorePromptSeen }),
    }),
    {
      name: 'riwaq-settings',
      storage: createJSONStorage(() => AsyncStorage),
      // v1: the bubble defaults ON — but a persisted blob from before this field
      // existed (or from when it defaulted OFF) would otherwise rehydrate it OFF
      // on existing installs. Force it ON once so the feature works out of the
      // box everywhere (the student can still turn it off afterwards).
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 1) return { ...state, bubbleConsent: true };
        return state;
      },
    },
  ),
);
