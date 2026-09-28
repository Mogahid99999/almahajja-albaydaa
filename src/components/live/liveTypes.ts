/**
 * Types derived from the core layer's Zustand store (src/stores/liveStore.ts),
 * so the UI follows its contract without re-declaring it.
 */
import type { useLiveStore } from '@/stores/liveStore';

export type LiveState = ReturnType<typeof useLiveStore.getState>;
export type LivePerson = LiveState['people'][string];
export type LiveConn = LiveState['conn'];
export type LiveCounts = LiveState['counts'];
export type IdentityChoice = 'named' | 'hidden';
