/**
 * Store update prompt (owner, 2026-11-18): replaces the gate that closed the
 * app below an admin-typed version. The app learns of a new store version by
 * itself and offers it in a popup that never blocks the app and comes back on
 * every opening until the person updates.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Platform, Text } from 'react-native';

import { REOPEN_AFTER_MS, StoreUpdatePrompt } from '@/components/StoreUpdatePrompt';
import { useLiveStore } from '@/stores/liveStore';
import { storeUpdatePromptPending, useStoreUpdateStore } from '@/stores/storeUpdateStore';
import { useTourStore } from '@/stores/tourStore';

const mockCheck = jest.fn();
const mockOpen = jest.fn();
jest.mock('@/stores/liveStore', () => {
  const { create } = jest.requireActual('zustand');
  return { useLiveStore: create(() => ({ session: null })) };
});
jest.mock('@/lib/storeUpdate', () => ({
  checkStoreUpdate: () => mockCheck(),
  openStoreUpdate: (u: unknown) => mockOpen(u),
}));

const UPDATE = { available: true, storeUrl: 'https://apps.apple.com/app/id6791291132' };

let appStateListener: ((s: string) => void) | null = null;
beforeEach(() => {
  jest.clearAllMocks();
  useStoreUpdateStore.setState({ update: null, dismissed: false });
  useTourStore.setState({ isActive: false, startHereVisible: false });
  useLiveStore.setState({ session: null } as never);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
    appStateListener = fn as (s: string) => void;
    return { remove: jest.fn() } as never;
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function App() {
  return (
    <>
      <Text>الرئيسية</Text>
      <StoreUpdatePrompt />
    </>
  );
}

test('a newer store version shows the popup over the app, which stays usable', async () => {
  mockCheck.mockResolvedValue(UPDATE);
  await render(<App />);
  expect(await screen.findByText('يتوفر إصدار جديد')).toBeTruthy();
  expect(screen.getByText('الرئيسية')).toBeTruthy();
  expect(storeUpdatePromptPending()).toBe(true);
});

test('no newer version → nothing shows', async () => {
  mockCheck.mockResolvedValue({ available: false, storeUrl: null });
  await render(<App />);
  await act(async () => {});
  expect(screen.queryByText('يتوفر إصدار جديد')).toBeNull();
});

test('«تحديث الآن» opens the store update', async () => {
  mockCheck.mockResolvedValue(UPDATE);
  await render(<App />);
  await fireEvent.press(await screen.findByText('تحديث الآن'));
  expect(mockOpen).toHaveBeenCalledWith(UPDATE);
});

test('«لاحقًا» hides it; it comes back when the app is opened again', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-18T10:00:00Z'));
  mockCheck.mockResolvedValue(UPDATE);
  await render(<App />);
  await fireEvent.press(await screen.findByText('لاحقًا'));
  expect(screen.queryByText('يتوفر إصدار جديد')).toBeNull();

  // A short trip away is the same opening: still hidden.
  await act(async () => {
    appStateListener?.('background');
    jest.setSystemTime(new Date(Date.now() + 60_000));
    appStateListener?.('active');
  });
  expect(screen.queryByText('يتوفر إصدار جديد')).toBeNull();

  // Back after a while = a new opening: asks again.
  await act(async () => {
    appStateListener?.('background');
    jest.setSystemTime(new Date(Date.now() + REOPEN_AFTER_MS));
    appStateListener?.('active');
  });
  expect(await screen.findByText('يتوفر إصدار جديد')).toBeTruthy();
  expect(mockCheck).toHaveBeenCalledTimes(2);
});

test('waits while the first-time tour or a live majlis is on screen', async () => {
  mockCheck.mockResolvedValue(UPDATE);
  useTourStore.setState({ isActive: true });
  await render(<App />);
  await act(async () => {});
  expect(screen.queryByText('يتوفر إصدار جديد')).toBeNull();

  await act(async () => useTourStore.setState({ isActive: false }));
  expect(screen.getByText('يتوفر إصدار جديد')).toBeTruthy();

  await act(async () => useLiveStore.setState({ session: {} } as never));
  expect(screen.queryByText('يتوفر إصدار جديد')).toBeNull();
});

test('never on web (the admin dashboard)', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  try {
    mockCheck.mockResolvedValue(UPDATE);
    await render(<App />);
    await act(async () => {});
    expect(mockCheck).not.toHaveBeenCalled();
    expect(screen.queryByText('يتوفر إصدار جديد')).toBeNull();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
