/**
 * Mushaf reading state — on this device only (AsyncStorage): last position
 * (saved on every page turn), bookmarks, the font-size level and whether the
 * reader chose the simplified mode while the Madinah pack isn't ready.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { clampPage } from './quran';

/** 0 = the mushaf page as printed; 1+ = enlarged, reflowed reading. */
export const FONT_LEVELS = [1, 1.2, 1.4, 1.65, 1.9] as const;

type MushafState = {
  lastPage: number | null;
  lastAt: number | null;
  bookmarks: number[];
  fontLevel: number;
  /** «اقرأ الآن بالخط المبسّط» chosen — open the reader directly while the pack downloads. */
  preferSimple: boolean;
  hintSeen: boolean;
  /** UTC+3 day of the last usage ping (touch_mushaf_open), so it fires at most daily. */
  usageDay: string | null;
  setLast: (page: number) => void;
  toggleBookmark: (page: number) => boolean;
  setFontLevel: (level: number) => void;
  setPreferSimple: (v: boolean) => void;
  setHintSeen: () => void;
  setUsageDay: (day: string) => void;
};

export const useMushafStore = create<MushafState>()(
  persist(
    (set, get) => ({
      lastPage: null,
      lastAt: null,
      bookmarks: [],
      fontLevel: 0,
      preferSimple: false,
      hintSeen: false,
      usageDay: null,
      setLast: (page) => set({ lastPage: clampPage(page), lastAt: Date.now() }),
      toggleBookmark: (page) => {
        const on = !get().bookmarks.includes(page);
        set({ bookmarks: on ? [page, ...get().bookmarks] : get().bookmarks.filter((p) => p !== page) });
        return on;
      },
      setFontLevel: (level) =>
        set({ fontLevel: Math.max(0, Math.min(FONT_LEVELS.length - 1, Math.round(level))) }),
      setPreferSimple: (preferSimple) => set({ preferSimple }),
      setHintSeen: () => set({ hintSeen: true }),
      setUsageDay: (usageDay) => set({ usageDay }),
    }),
    { name: 'mushaf-reading', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);

/** Today's date in Makkah time (UTC+3), YYYY-MM-DD — matches the server's day. */
export const makkahDay = (now = Date.now()) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
