import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Android-only bookkeeping for the Storage Access Framework (SAF) grant used
 * to save downloaded lectures into a visible public folder (My Files /
 * Downloads) instead of the app's private sandbox. Persisted so the user only
 * picks the folder once; read outside React (plain module, not a hook) by
 * src/lib/downloads.ts, so this is a vanilla zustand store accessed via
 * getState()/setState() there.
 */
type PublicStorageState = {
  /** content:// tree URI the user granted via the native folder picker. */
  rootUri: string | null;
  /** content:// URI of the "المحجة البيضاء" folder created inside rootUri. */
  appFolderUri: string | null;
  /** Sanitized section name → content:// URI of its subfolder inside appFolderUri. */
  sectionDirs: Record<string, string>;
  setRootUri: (rootUri: string | null) => void;
  setAppFolderUri: (appFolderUri: string | null) => void;
  setSectionDir: (section: string, uri: string) => void;
  /** Drops all cached URIs (e.g. the root grant was revoked or replaced). */
  reset: () => void;
};

export const usePublicStorageStore = create<PublicStorageState>()(
  persist(
    (set) => ({
      rootUri: null,
      appFolderUri: null,
      sectionDirs: {},
      setRootUri: (rootUri) => set({ rootUri }),
      setAppFolderUri: (appFolderUri) => set({ appFolderUri }),
      setSectionDir: (section, uri) =>
        set((s) => ({ sectionDirs: { ...s.sectionDirs, [section]: uri } })),
      reset: () => set({ rootUri: null, appFolderUri: null, sectionDirs: {} }),
    }),
    {
      name: 'riwaq-public-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
