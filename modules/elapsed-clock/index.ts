// Quiz countdown (0174): time that the device clock cannot move. Null on web and on builds
// that predate this module; callers then fall back to the wall clock.
import { requireOptionalNativeModule } from 'expo-modules-core';

type ElapsedClockNative = { elapsedRealtime(): number };

const native = requireOptionalNativeModule<ElapsedClockNative>('ElapsedClock');

export function elapsedRealtimeMs(): number | null {
  return native ? native.elapsedRealtime() : null;
}
