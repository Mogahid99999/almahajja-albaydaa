import { create } from 'zustand';

/**
 * Global audio-player UI state, shared by the mini player, full player, Home
 * feature card, and section in-progress rows. The actual expo-audio instance
 * lives in `src/lib/audioController.ts`, which is the only writer of these
 * setters — components read this store and call the controller to act.
 */
export type PlaybackRate = number;
/** Playback speed slider bounds (PlayerUtilityBar): 0.8×–2.0× in 0.1 steps. */
export const RATE_MIN = 0.8;
export const RATE_MAX = 2.0;
export const RATE_STEP = 0.1;

type PlayerState = {
  currentLectureId: string | null;
  title: string | null;
  sheikhName: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  rate: PlaybackRate;
  /** The next lecture in the section, resolved after a track loads (null = none). */
  nextLectureId: string | null;
  /** The previous lecture in the section, resolved after a track loads (null = none). */
  prevLectureId: string | null;
  /**
   * expo-audio's `AudioStatus.error` surfaced (Phase 3.5 — "Source error" hang).
   * Non-null means the current track failed to load/play; the full player shows
   * a calm retry state instead of leaving `isLoading` stuck true forever. Cleared
   * whenever a new track loads (`setTrack`) or a load/retry succeeds.
   */
  loadError: string | null;
  /**
   * The current STREAMED track is re-buffering mid-playback (weak or lost
   * signal) — `AudioStatus.isBuffering` while already loaded. Surfaced as a calm
   * "reconnecting" hint so a stalled stream doesn't read as a frozen player;
   * distinct from `isLoading` (the initial open). Auto-clears the moment audio
   * flows again, and connectivity recovery (audioController) re-attempts on a
   * full reconnect.
   */
  isStalled: boolean;
};

type PlayerActions = {
  setTrack: (t: {
    id: string;
    title: string;
    sheikhName: string | null;
    durationSec: number;
    positionSec?: number;
  }) => void;
  setPlaying: (isPlaying: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setPosition: (positionSec: number) => void;
  setDuration: (durationSec: number) => void;
  setRate: (rate: PlaybackRate) => void;
  setNext: (nextLectureId: string | null) => void;
  setPrev: (prevLectureId: string | null) => void;
  setLoadError: (loadError: string | null) => void;
  setStalled: (isStalled: boolean) => void;
  reset: () => void;
};

const initial: PlayerState = {
  currentLectureId: null,
  title: null,
  sheikhName: null,
  isPlaying: false,
  isLoading: false,
  positionSec: 0,
  durationSec: 0,
  rate: 1.0,
  nextLectureId: null,
  prevLectureId: null,
  loadError: null,
  isStalled: false,
};

export const usePlayerStore = create<PlayerState & PlayerActions>((set) => ({
  ...initial,
  setTrack: (t) =>
    set({
      currentLectureId: t.id,
      title: t.title,
      sheikhName: t.sheikhName,
      durationSec: t.durationSec,
      positionSec: t.positionSec ?? 0,
      // A new track's neighbours are unknown until resolved by the controller.
      nextLectureId: null,
      prevLectureId: null,
      // A new load attempt starts clean — any previous track's failure must not
      // bleed into this one.
      loadError: null,
      isStalled: false,
    }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setLoading: (isLoading) => set({ isLoading }),
  setPosition: (positionSec) => set({ positionSec }),
  setDuration: (durationSec) => set({ durationSec }),
  setRate: (rate) => set({ rate }),
  setNext: (nextLectureId) => set({ nextLectureId }),
  setPrev: (prevLectureId) => set({ prevLectureId }),
  setLoadError: (loadError) => set({ loadError }),
  setStalled: (isStalled) => set({ isStalled }),
  reset: () => set(initial),
}));
