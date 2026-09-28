// Android foreground service for a live «الحلقة» session (V23 P3). No-op on iOS/web: iOS keeps
// WebRTC playing through the `audio` background mode, and web has no student listening.
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

type LiveForegroundNative = {
  start(title: string, text: string, withMic: boolean, url: string | null): boolean;
  stop(): boolean;
  addListener(event: 'onAction', listener: (e: { action: string }) => void): EventSubscription;
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
