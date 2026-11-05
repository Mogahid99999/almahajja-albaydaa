// Android foreground service for a live «الحلقة» session (V23 P3). No-op on iOS/web: iOS keeps
// WebRTC playing through the `audio` background mode, and web has no student listening.
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

type LiveForegroundNative = {
  start(title: string, text: string, withMic: boolean, url: string | null): boolean;
  stop(): boolean;
  setTimer(id: number, ms: number, repeat: boolean): void;
  clearTimer(id: number): void;
  addListener(event: 'onAction', listener: (e: { action: string }) => void): EventSubscription;
  addListener(event: 'onTimer', listener: (e: { id: number }) => void): EventSubscription;
};

const native: LiveForegroundNative | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<LiveForegroundNative>('LiveForeground') : null;

/** Show/refresh the ongoing «مباشر الآن» notification and keep audio alive with the screen off. */
export function startLiveForeground(opts: {
  title: string;
  text: string;
  withMic?: boolean;
  url?: string | null;
}): void {
  native?.start(opts.title, opts.text, opts.withMic ?? false, opts.url ?? null);
}

export function stopLiveForeground(): void {
  native?.stop();
}

/** The notification's «مغادرة» action. Returns an unsubscribe function. */
export function onLiveForegroundLeave(listener: () => void): () => void {
  const sub = native?.addListener('onAction', (e) => {
    if (e.action === 'leave') listener();
  });
  return () => sub?.remove();
}

export type BackgroundTimers = {
  setTimeout(cb: () => void, ms?: number): number;
  setInterval(cb: () => void, ms?: number): number;
  clearTimeout(id: number | undefined): void;
  clearInterval(id: number | undefined): void;
};

/**
 * Timers that keep running while the app is in the background (Android), for livekit-client's
 * CriticalTimers — see LiveForegroundModule.kt. React Native's own JS timers stop in the
 * background, so the SDK's signal ping timeout went overdue and fired the instant the app came
 * back → reconnect / full re-join («جارٍ الدخول إلى الحلقة», 2026-11-05 prod live). null where
 * there is no native module (iOS keeps JS running in the audio background mode; web; Expo Go).
 */
export const backgroundTimers: BackgroundTimers | null = native ? createBackgroundTimers(native) : null;

function createBackgroundTimers(n: LiveForegroundNative): BackgroundTimers {
  const callbacks = new Map<number, { cb: () => void; repeat: boolean }>();
  let nextId = 1;
  n.addListener('onTimer', ({ id }) => {
    const t = callbacks.get(id);
    if (!t) return; // cleared meanwhile (the event was already on its way)
    if (!t.repeat) callbacks.delete(id);
    t.cb();
  });
  const start = (cb: () => void, ms: number | undefined, repeat: boolean) => {
    const id = nextId++;
    callbacks.set(id, { cb, repeat });
    n.setTimer(id, Math.max(0, ms ?? 0), repeat);
    return id;
  };
  const clear = (id: number | undefined) => {
    if (id == null || !callbacks.delete(id)) return;
    n.clearTimer(id);
  };
  return {
    setTimeout: (cb, ms) => start(cb, ms, false),
    setInterval: (cb, ms) => start(cb, ms, true),
    clearTimeout: clear,
    clearInterval: clear,
  };
}
