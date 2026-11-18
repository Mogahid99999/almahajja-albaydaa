/**
 * connectivity — a stale «offline» is corrected on return to the foreground
 * (2026-11-15). A frozen background app can miss the "back online" event, so
 * the app kept believing it was offline (players: «هذه المحاضرة تحتاج اتصالاً»,
 * lists stopped loading) until it was restarted.
 */
import { onlineManager } from '@tanstack/react-query';

let mockState = { isConnected: true, isInternetReachable: true as boolean | undefined };
const mockAppStateListeners: Array<(s: string) => void> = [];

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => mockState),
  addNetworkStateListener: jest.fn(() => ({ remove: () => {} })),
}));

import { AppState } from 'react-native';
import { initConnectivity, isOnlineSync, refreshOnline } from '../connectivity';

jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, cb: (s: string) => void) => {
  mockAppStateListeners.push(cb);
  return { remove: () => {} };
}) as never);

const flush = () => new Promise((r) => setImmediate(r));

beforeAll(async () => {
  initConnectivity();
  await flush();
});

test('refreshOnline replaces a stale offline state with the real one', async () => {
  onlineManager.setOnline(false); // the missed "back online" event
  mockState = { isConnected: true, isInternetReachable: true };
  await expect(refreshOnline()).resolves.toBe(true);
  expect(isOnlineSync()).toBe(true);
});

test('returning to the foreground re-reads the state', async () => {
  onlineManager.setOnline(false);
  mockState = { isConnected: true, isInternetReachable: undefined };
  mockAppStateListeners.forEach((cb) => cb('active'));
  await flush();
  expect(isOnlineSync()).toBe(true);
});

test('a real offline stays offline', async () => {
  mockState = { isConnected: false, isInternetReachable: false };
  await expect(refreshOnline()).resolves.toBe(false);
  expect(isOnlineSync()).toBe(false);
});
