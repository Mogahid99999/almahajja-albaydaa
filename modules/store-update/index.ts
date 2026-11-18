// Store update prompt (2026-11-18): Google Play In-App Updates on Android. Null on iOS, on
// web and on builds that predate this module; src/lib/storeUpdate.ts handles those.
import { requireOptionalNativeModule } from 'expo-modules-core';

export type PlayUpdateInfo = { available: boolean; availableVersionCode?: number };

type StoreUpdateNative = {
  check(): Promise<PlayUpdateInfo>;
  start(): Promise<boolean>;
};

export const playUpdates = requireOptionalNativeModule<StoreUpdateNative>('StoreUpdate');
