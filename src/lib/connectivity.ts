/**
 * Connectivity foundation (V11 · A).
 *
 * Bridges `expo-network` to TanStack Query's `onlineManager` so that paused
 * `offlineFirst` queries resume the moment the network returns (instead of
 * waiting for the next mount/focus), and gives the offline outbox (src/lib/outbox)
 * a reliable "we're back online" signal + a one-shot / synchronous online check.
 *
 * No offline banner — the V10 decision stands; the app just quietly works. This
 * module only observes connectivity; nothing here renders.
 */
import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

/**
 * A state counts as "online" when there is an active connection AND the internet
 * isn't known to be unreachable. `isInternetReachable` can be undefined on some
 * platforms/first reads, so only an explicit `false` blocks it (matches the plan:
 * `isConnected && isInternetReachable !== false`).
 */
function deriveOnline(state: Network.NetworkState): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

/** Callbacks fired on an offline→online transition (outbox flush trigger). */
const reconnectListeners = new Set<() => void>();
let prevOnline = true;
let started = false;

/**
 * Wire `onlineManager` to expo-network's connectivity stream and seed the initial
 * state. Idempotent + safe to call at module scope. On web (admin dashboard) the
 * native listener may be unavailable, so everything is guarded — web is assumed
 * online, exactly as before.
 */
export function initConnectivity(): void {
  if (started) return;
  started = true;

  // Track offline→online edges so registered `onReconnect` callbacks fire exactly
  // once per recovery (onlineManager notifies on every change).
  prevOnline = onlineManager.isOnline();
  onlineManager.subscribe((online: boolean) => {
    if (online && !prevOnline) {
      for (const cb of reconnectListeners) {
        try {
          cb();
        } catch {
          /* a listener error must never break connectivity handling */
        }
      }
    }
    prevOnline = online;
  });

  if (Platform.OS === 'web') return; // web: leave onlineManager on its default (online)

  // Drive onlineManager off the real device connectivity stream. Debounced: on a
  // weak/borderline signal `expo-network` can flip isConnected/isInternetReachable
  // every couple of seconds even though the underlying connection never really
  // drops. Without this, each flicker read as a full offline→online edge and
  // re-fired every `onReconnect` listener (audioController's stream-recovery
  // among them), producing a visible reload/retry loop in sync with the flicker
  // instead of the intended "recover once after a real drop".
  const DEBOUNCE_MS = 1500;
  onlineManager.setEventListener((setOnline) => {
    let sub: { remove: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      sub = Network.addNetworkStateListener((state) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setOnline(deriveOnline(state)), DEBOUNCE_MS);
      });
    } catch {
      /* listener unsupported — the seed below still sets a sane initial value */
    }
    return () => {
      if (timer) clearTimeout(timer);
      try {
        sub?.remove();
      } catch {
        /* ignored */
      }
    };
  });

  // The listener may not fire immediately, so seed the current state once.
  void Network.getNetworkStateAsync()
    .then((state) => onlineManager.setOnline(deriveOnline(state)))
    .catch(() => {
      /* keep the default (online) if the probe fails */
    });
}

/**
 * One-shot connectivity probe (used by the outbox before a flush attempt). Fails
 * OPEN — if the probe itself errors we assume online and let the real request
 * decide, so a flaky probe never wedges the queue.
 */
export async function isOnline(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    return deriveOnline(await Network.getNetworkStateAsync());
  } catch {
    return true;
  }
}

/**
 * Synchronous best-known online state (kept fresh by {@link initConnectivity}).
 * Used on the hot playback-tick path to short-circuit a doomed network write to
 * the outbox without awaiting a probe.
 */
export function isOnlineSync(): boolean {
  return onlineManager.isOnline();
}

/** Register a callback fired on each offline→online transition. Returns an unsubscribe. */
export function onReconnect(cb: () => void): () => void {
  reconnectListeners.add(cb);
  return () => reconnectListeners.delete(cb);
}
