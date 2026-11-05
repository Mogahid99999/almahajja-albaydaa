/**
 * The background-cut regression (2026-11-05 prod live; device logs 2026-11-06): React Native's JS
 * timers stop while the app is in the background (the Choreographer frame clock stops; a headless
 * task does not help on the New Architecture — verified on device). livekit-client's signal ping
 * and ping timeout are JS timers, so the overdue timeout fired the instant the app returned
 * («ping timeout triggered») → reconnect / full re-join («جارٍ الدخول إلى الحلقة», ~35 s silent).
 * The fix gives the SDK's CriticalTimers native timers (main Looper → `onTimer` events, which do
 * reach JS in the background). This pins the JS half of that contract.
 */
type TimerEvent = { id: number };
let mockTimerListener: ((e: TimerEvent) => void) | null = null;
const mockNative = {
  start: jest.fn(() => true),
  stop: jest.fn(() => true),
  setTimer: jest.fn(),
  clearTimer: jest.fn(),
  addListener: jest.fn((event: string, l: (e: TimerEvent) => void) => {
    if (event === 'onTimer') mockTimerListener = l;
    return { remove: jest.fn() };
  }),
};
let mockHasNative = true;

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => (mockHasNative ? mockNative : null),
}));
jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.Platform.OS = 'android';
  return rn;
});

function load() {
  let mod!: typeof import('../../../modules/live-foreground');
  jest.isolateModules(() => {
    mod = require('../../../modules/live-foreground');
  });
  return mod;
}

const fire = (id: number) => mockTimerListener?.({ id });

beforeEach(() => {
  mockHasNative = true;
  mockTimerListener = null;
  for (const f of [mockNative.setTimer, mockNative.clearTimer, mockNative.addListener]) f.mockClear();
});

test('no native module (iOS / web / old binary) → no background timers; the SDK keeps its own', () => {
  mockHasNative = false;
  expect(load().backgroundTimers).toBeNull();
});

test('setTimeout runs on a native one-shot timer and fires once on its event', () => {
  const t = load().backgroundTimers!;
  const cb = jest.fn();
  const id = t.setTimeout(cb, 15_000);
  expect(mockNative.setTimer).toHaveBeenCalledWith(id, 15_000, false);
  fire(id);
  fire(id); // a late duplicate never re-runs a one-shot
  expect(cb).toHaveBeenCalledTimes(1);
});

test('setInterval repeats until cleared', () => {
  const t = load().backgroundTimers!;
  const cb = jest.fn();
  const id = t.setInterval(cb, 5_000);
  expect(mockNative.setTimer).toHaveBeenCalledWith(id, 5_000, true);
  fire(id);
  fire(id);
  t.clearInterval(id);
  expect(mockNative.clearTimer).toHaveBeenCalledWith(id);
  fire(id); // already queued on the JS side: ignored
  expect(cb).toHaveBeenCalledTimes(2);
});

test('clearTimeout cancels: a cleared ping timeout never closes the signal', () => {
  const t = load().backgroundTimers!;
  const cb = jest.fn();
  const id = t.setTimeout(cb, 15_000);
  t.clearTimeout(id);
  fire(id);
  expect(cb).not.toHaveBeenCalled();
  expect(() => t.clearTimeout(undefined)).not.toThrow(); // SDK clears unset handles
});

test('every timer gets its own id and only its own callback runs', () => {
  const t = load().backgroundTimers!;
  const a = jest.fn();
  const b = jest.fn();
  const ida = t.setTimeout(a, 10);
  const idb = t.setTimeout(b, 10);
  expect(ida).not.toBe(idb);
  fire(idb);
  expect(a).not.toHaveBeenCalled();
  expect(b).toHaveBeenCalledTimes(1);
});

test('installCriticalTimers routes the SDK ping / ping-timeout timers onto the native timers', () => {
  let client!: typeof import('../liveClient');
  jest.isolateModules(() => {
    client = require('../liveClient');
  });
  const CriticalTimers = { setTimeout, setInterval, clearTimeout, clearInterval } as Record<string, unknown>;
  client.installCriticalTimers({ CriticalTimers } as never);

  const ping = jest.fn();
  const timeout = jest.fn();
  const pingId = (CriticalTimers.setInterval as (cb: () => void, ms: number) => number)(ping, 5_000);
  const timeoutId = (CriticalTimers.setTimeout as (cb: () => void, ms: number) => number)(timeout, 15_000);
  expect(mockNative.setTimer).toHaveBeenCalledWith(pingId, 5_000, true);
  expect(mockNative.setTimer).toHaveBeenCalledWith(timeoutId, 15_000, false);

  fire(pingId);
  (CriticalTimers.clearTimeout as (id: number) => void)(timeoutId); // the pong arrived
  fire(timeoutId);
  expect(ping).toHaveBeenCalledTimes(1);
  expect(timeout).not.toHaveBeenCalled();
});
