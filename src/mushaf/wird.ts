/**
 * «ورد القرآن اليومي» — the daily pages goal, on this device (AsyncStorage).
 *
 * Kept apart from the reading position on purpose: `lastPage` (store.ts) is
 * where the reader stopped; `pages` here is which printed pages counted toward
 * TODAY's wird. A page is identified by its printed page number (1–604) in both
 * the Madinah print and the simplified/enlarged text, so switching mode or font
 * size can never count it twice.
 *
 * A new device-local day resets `pages` only — the goal, the reading position,
 * bookmarks and settings stay. The server learns one fact, once per day: «the
 * wird was completed» (record_quran_wird_day, via the outbox → offline-safe).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { flushOutbox } from '@/lib/outbox';
import { enqueueWirdDay, localDay } from '@/lib/outboxQueue';

import { PAGE_COUNT, pageWordCount, toLatinDigits } from './quran';

export const WIRD_PRESETS = [1, 2, 5, 10] as const;
export const WIRD_MIN = 1;
export const WIRD_MAX = 60;

/** A valid custom goal, or null when the input isn't one. */
export function parseWirdGoal(input: string | number): number | null {
  const raw = typeof input === 'number' ? String(input) : toLatinDigits(input).trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < WIRD_MIN || n > WIRD_MAX) return null;
  return n;
}

/**
 * How long a page must be on screen (the app in front) before it counts:
 * ~0.15 s a word — far under a real reading of the page, far over a flip —
 * between 8 s (الفاتحة, the short last pages) and 25 s (a full page).
 */
export function dwellMsFor(page: number): number {
  return Math.round(Math.min(25_000, Math.max(8_000, pageWordCount(page) * 150)));
}

export type WirdData = {
  /** Pages a day; null = «بدون هدف يومي». */
  goal: number | null;
  /** The reader chose (a goal or none) at least once — the setup is not offered again. */
  configured: boolean;
  /** Device-local day `pages` belongs to. */
  day: string;
  /** Printed pages counted today, each once. */
  pages: number[];
  /** Day the goal was reached (feedback + server record happen once per day). */
  doneDay: string | null;
};

export const EMPTY_WIRD: WirdData = { goal: null, configured: false, day: '', pages: [], doneDay: null };

/** The state as of `today`: a new day starts with no pages; nothing else changes. */
export function wirdForDay(s: WirdData, today: string): WirdData {
  return s.day === today ? s : { ...s, day: today, pages: [] };
}

export type WirdProgress = { goal: number | null; count: number; done: boolean };

/**
 * `done` follows the current goal (raising it after finishing shows the new
 * remainder); `doneDay` only makes the feedback + the server record once a day.
 */
export function wirdProgress(s: WirdData, today: string): WirdProgress {
  const d = wirdForDay(s, today);
  return { goal: d.goal, count: d.pages.length, done: d.goal != null && d.pages.length >= d.goal };
}

/** Reached the goal and not yet marked today. */
const reaches = (s: WirdData, today: string) =>
  s.goal != null && s.pages.length >= s.goal && s.doneDay !== today;

/** Count a page for `today`. `completedNow` is true exactly once per day. */
export function creditPage(
  s: WirdData,
  page: number,
  today: string,
): { next: WirdData; credited: boolean; completedNow: boolean } {
  const d = wirdForDay(s, today);
  if (!Number.isInteger(page) || page < 1 || page > PAGE_COUNT || d.pages.includes(page)) {
    return { next: d, credited: false, completedNow: false };
  }
  const next = { ...d, pages: [...d.pages, page] };
  if (reaches(next, today)) return { next: { ...next, doneDay: today }, credited: true, completedNow: true };
  return { next, credited: true, completedNow: false };
}

/** Set (or remove, with null) the daily goal. Today's pages are kept. */
export function withGoal(s: WirdData, goal: number | null, today: string): { next: WirdData; completedNow: boolean } {
  const d = { ...wirdForDay(s, today), goal, configured: true };
  // Lowering the goal under what was already read today completes it.
  if (reaches(d, today)) return { next: { ...d, doneDay: today }, completedNow: true };
  return { next: d, completedNow: false };
}

type WirdStore = WirdData & {
  setGoal: (goal: number | null) => void;
  /** Count a page read now; returns true when this page completed today's wird. */
  credit: (page: number) => boolean;
};

/** Record the completed day for the journey; sent now when online, else on reconnect. */
const recordDone = (day: string) => {
  void enqueueWirdDay(day).then(() => flushOutbox());
};

const pick = (s: WirdStore): WirdData => ({
  goal: s.goal,
  configured: s.configured,
  day: s.day,
  pages: s.pages,
  doneDay: s.doneDay,
});

export const useWirdStore = create<WirdStore>()(
  persist(
    (set, get) => ({
      ...EMPTY_WIRD,
      setGoal: (goal) => {
        const today = localDay();
        const { next, completedNow } = withGoal(pick(get()), goal, today);
        set(next);
        if (completedNow) recordDone(today);
      },
      credit: (page) => {
        const today = localDay();
        const { next, credited, completedNow } = creditPage(pick(get()), page, today);
        if (credited || next.day !== get().day) set(next);
        if (completedNow) recordDone(today);
        return completedNow;
      },
    }),
    {
      name: 'mushaf-wird',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: pick,
    },
  ),
);
