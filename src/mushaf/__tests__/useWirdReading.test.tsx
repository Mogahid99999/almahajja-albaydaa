/**
 * useWirdReading — a page counts only once it has really been in front of the
 * reader: not on a quick flip, not on a jump from search / a bookmark, not while
 * the app is in the background, and never twice (font size / mode changes
 * re-render the same printed page).
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

jest.mock('@/lib/outboxQueue', () => ({ enqueueWirdDay: jest.fn(async () => {}), localDay: () => '2026-10-26' }));
jest.mock('@/lib/outbox', () => ({ flushOutbox: jest.fn(async () => {}) }));

import { useWirdReading } from '../useWirdReading';
import { EMPTY_WIRD, dwellMsFor, useWirdStore } from '../wird';

let appListener: ((s: AppStateStatus) => void) | null = null;
let appSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  useWirdStore.setState({ ...EMPTY_WIRD, goal: 5, configured: true });
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  appSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, fn) => {
    appListener = fn as (s: AppStateStatus) => void;
    return { remove: () => (appListener = null) } as never;
  });
});
afterEach(() => {
  jest.useRealTimers();
  appSpy.mockRestore();
});

const pages = () => useWirdStore.getState().pages;
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

async function reader(start: number) {
  const onComplete = jest.fn();
  const view = await renderHook(({ page }: { page: number }) => useWirdReading(page, true, onComplete), {
    initialProps: { page: start },
  });
  return { ...view, onComplete };
}

test('opening a page does not count it; reading it for its time does', async () => {
  const { unmount } = await reader(300);
  await advance(3000);
  expect(pages()).toEqual([]);
  await advance(dwellMsFor(300) - 3000);
  expect(pages()).toEqual([300]);
  await unmount();
});

test('flipping quickly through ten pages counts none of them', async () => {
  const { rerender, unmount } = await reader(100);
  for (let p = 101; p <= 110; p++) {
    await advance(1500);
    await rerender({ page: p });
  }
  await advance(1500);
  expect(pages()).toEqual([]);
  await unmount();
});

test('a jump from search or a bookmark is not counted on arrival', async () => {
  const { rerender, unmount } = await reader(5);
  await rerender({ page: 450 }); // the jump
  await advance(2000);
  await rerender({ page: 2 }); // and away again
  await advance(2000);
  expect(pages()).toEqual([]);
  await unmount();
});

test('changing the font size or mode on the same page neither restarts nor doubles it', async () => {
  const { rerender, unmount } = await reader(187);
  await advance(dwellMsFor(187) - 4000);
  await rerender({ page: 187 }); // re-render: enlarged / print / simplified
  await rerender({ page: 187 });
  await advance(4000);
  expect(pages()).toEqual([187]);
  await advance(60_000);
  expect(pages()).toEqual([187]);
  await unmount();
});

test('going back to a page already counted does not add to the count', async () => {
  const { rerender, unmount } = await reader(50);
  await advance(dwellMsFor(50));
  await rerender({ page: 51 });
  await advance(dwellMsFor(51));
  await rerender({ page: 50 });
  await advance(dwellMsFor(50) * 2);
  expect(pages()).toEqual([50, 51]);
  await unmount();
});

test('time in the background does not count', async () => {
  const { unmount } = await reader(300);
  await advance(2000);
  await act(() => appListener?.('background'));
  await advance(10 * 60_000);
  expect(pages()).toEqual([]);
  await act(() => appListener?.('active'));
  await advance(dwellMsFor(300) - 2000);
  expect(pages()).toEqual([300]);
  await unmount();
});

test('completion is reported once to the reader', async () => {
  useWirdStore.setState({ goal: 2 });
  const { rerender, onComplete, unmount } = await reader(10);
  await advance(dwellMsFor(10));
  await rerender({ page: 11 });
  await advance(dwellMsFor(11));
  await rerender({ page: 12 });
  await advance(dwellMsFor(12));
  expect(pages()).toEqual([10, 11, 12]);
  expect(onComplete).toHaveBeenCalledTimes(1);
  await unmount();
});

test('without a daily goal nothing is tracked', async () => {
  useWirdStore.setState({ goal: null });
  const { unmount } = await reader(300);
  await advance(120_000);
  expect(pages()).toEqual([]);
  await unmount();
});
