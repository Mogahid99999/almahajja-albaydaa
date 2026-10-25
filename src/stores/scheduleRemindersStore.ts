/**
 * «ذكّرني قبل الدرس» (0158) — which lessons this device reminds about. Kept
 * on the device only (persisted); the reminders themselves are local
 * notifications planned by src/lib/scheduleReminders.ts. Nothing reaches the
 * server, so a thousand students turning reminders on cost it nothing.
 *
 * LOAD V25: each install also keeps a fixed random offset (0–5 min) so one
 * lesson's reminders reach a thousand phones over five minutes, not in the
 * same second (a synchronized tap = a synchronized app-open wave).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** The reminders of one lesson are spread over this much (per install). */
export const REMINDER_SPREAD_MS = 5 * 60_000;

type ScheduleRemindersState = {
  /** schedule_items ids. */
  ids: string[];
  /** This install's extra lead (0 … REMINDER_SPREAD_MS); persisted with the first choice. */
  jitterMs: number;
  setReminder: (itemId: string, on: boolean) => void;
};

export const useScheduleRemindersStore = create<ScheduleRemindersState>()(
  persist(
    (set) => ({
      ids: [],
      jitterMs: Math.floor(Math.random() * REMINDER_SPREAD_MS),
      setReminder: (itemId, on) =>
        set((s) => ({
          ids: on ? Array.from(new Set([...s.ids, itemId])) : s.ids.filter((id) => id !== itemId),
        })),
    }),
    {
      name: 'riwaq-schedule-reminders',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
