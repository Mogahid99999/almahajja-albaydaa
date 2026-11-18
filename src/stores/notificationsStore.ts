import { create } from 'zustand';

/**
 * Device-level notification state (Phase 2 · feature B): the OS permission status
 * and this device's Expo push token, plus a flag so we register the token at most
 * once per app run. Mirrors how `playerStore`/`downloadsStore` hold device/UI
 * state — server-side prefs/follows/inbox live in TanStack Query, not here.
 *
 * The bootstrap in app/_layout.tsx drives this; UI reads `granted` for the small
 * permission affordances.
 */
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

type NotificationsState = {
  permission: NotificationPermission;
  /** Expo push token for this device, once resolved (null on web / simulator). */
  token: string | null;
  /** The account this run's token was registered for (avoids re-registering it). */
  registeredUserId: string | null;
};

type NotificationsActions = {
  setPermission: (permission: NotificationPermission) => void;
  setToken: (token: string | null) => void;
  setRegisteredUserId: (userId: string | null) => void;
};

export const useNotificationsStore = create<NotificationsState & NotificationsActions>(
  (set) => ({
    permission: 'undetermined',
    token: null,
    registeredUserId: null,
    setPermission: (permission) => set({ permission }),
    setToken: (token) => set({ token }),
    setRegisteredUserId: (registeredUserId) => set({ registeredUserId }),
  }),
);
