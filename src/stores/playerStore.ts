import { create } from 'zustand';

/**
 * Global audio-player UI state, shared by the mini player, full player, Home
 * feature card, and section in-progress rows. The actual expo-audio instance
 * lives in `src/lib/audioController.ts`, which is the only writer of these
 * setters — components read this store and call the controller to act.
 */
export type PlaybackRate = 0.75 | 1.0 | 1.25 | 1.5 | 2.0;
export const PLAYBACK_RATES: PlaybackRate[] = [0.75, 1.0, 1.25, 1.5, 2.0];

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
      // A new track's "next" is unknown until resolved by the controller.
      nextLectureId: null,
    }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setLoading: (isLoading) => set({ isLoading }),
  setPosition: (positionSec) => set({ positionSec }),
  setDuration: (durationSec) => set({ durationSec }),
  setRate: (rate) => set({ rate }),
  setNext: (nextLectureId) => set({ nextLectureId }),
  reset: () => set(initial),
}));
