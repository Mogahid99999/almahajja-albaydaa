/**
 * Cross-platform audio duration reader for the admin upload form.
 *
 * Web (the primary admin surface) reads it from a hidden <audio> element. Native
 * (admin on a phone) briefly loads the file with expo-audio and reads the
 * duration it reports. Returns null when it can't be determined — the insert
 * then stores a null `duration_sec` and the player recovers the real length from
 * playback (Issue 6 / Issue 7 duration-truth).
 */
import { Platform } from 'react-native';

export function extractAudioDuration(uri: string): Promise<number | null> {
  return Platform.OS === 'web' ? extractWeb(uri) : extractNative(uri);
}

function extractWeb(uri: string): Promise<number | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const finish = (v: number | null) => {
      audio.src = '';
      resolve(v);
    };
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    audio.onerror = () => finish(null);
    audio.src = uri;
  });
}

function extractNative(uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    // Loosely typed — the module is lazily required (see below), so it isn't in
    // scope for the web bundle / the type checker.
    let player: any = null;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      try {
        player?.remove?.();
      } catch {
        /* already gone */
      }
      resolve(v);
    };
    try {
      // Lazy require so web never resolves the native audio module for this.
      const { createAudioPlayer } = require('expo-audio');
      player = createAudioPlayer({ uri }, { updateInterval: 250 });
      player.addListener?.('playbackStatusUpdate', (st: { duration?: number }) => {
        if (st.duration && st.duration > 0) finish(Math.round(st.duration));
      });
      // Safety net — never hang the picker on a file we can't decode.
      setTimeout(() => {
        finish(player?.duration && player.duration > 0 ? Math.round(player.duration) : null);
      }, 6000);
    } catch {
      finish(null);
    }
  });
}
