/**
 * src/components/live/LivePeekSheet.tsx — how a room screen closes (device
 * 2026-09-30). A link / notification to another majlis PUSHES a second room
 * over the open one (expo-router's Stack: another id = another screen); once
 * the new session is joined the covered room asks to close. router.back() then
 * popped the NEW room (joined, nothing shown); pulling the covered room out
 * from under the new one froze react-native-screens on Android (nothing shown,
 * nothing opened afterwards). The rules pinned here: a covered room never
 * navigates; it closes together with the room above it (popped from the top)
 * or by itself once uncovered; a room on top closes as it always did.
 * The full link → room flow on the real router: live-room-deeplink.test.tsx.
 */
import { createContext } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

type Route = { key: string; name: string };
const mockStack: { current: { key: string; index: number; routes: Route[] } } = {
  current: { key: 'root', index: 0, routes: [] },
};
const mockRouter = { back: jest.fn(), replace: jest.fn(), dismiss: jest.fn(), canGoBack: jest.fn(() => true) };
const mockFocus: Record<string, () => void> = {};
const mockRouteKey = createContext('live-A');
jest.mock('expo-router', () => {
  const { useContext } = require('react');
  const navs: Record<string, unknown> = {};
  return {
    useRouter: () => mockRouter,
    useRoute: () => ({ key: useContext(mockRouteKey), name: 'live/[id]' }),
    useNavigation: () => {
      const key: string = useContext(mockRouteKey);
      navs[key] ??= {
        getState: () => mockStack.current,
        addListener: (type: string, cb: () => void) => {
          if (type === 'focus') mockFocus[key] = cb;
          return () => {
            delete mockFocus[key];
          };
        },
      };
      return navs[key];
    },
  };
});

import { LivePeekSheet } from '@/components/live/LivePeekSheet';

function setStack(...keys: string[]) {
  mockStack.current = { key: 'root', index: keys.length - 1, routes: keys.map((key) => ({ key, name: key })) };
}

/** A room screen (route `routeKey`) with a close button. */
function Room({ routeKey, label }: { routeKey: string; label: string }) {
  return (
    <mockRouteKey.Provider value={routeKey}>
      <LivePeekSheet>
        {(collapse) => (
          <Pressable onPress={collapse} accessibilityRole="button">
            <Text>{label}</Text>
          </Pressable>
        )}
      </LivePeekSheet>
    </mockRouteKey.Provider>
  );
}

function expectNoNavigation() {
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.dismiss).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
}

beforeEach(() => {
  mockRouter.canGoBack.mockReturnValue(true);
});

test('a covered room asking to close never navigates — it neither pops the new room nor is pulled from under it', async () => {
  setStack('sheikh', 'live-A', 'live-B');
  await render(<Room routeKey="live-A" label="إغلاق المجلس السابق" />);
  await fireEvent.press(screen.getByText('إغلاق المجلس السابق'));
  expectNoNavigation();
});

test('the new room closing takes the covered room with it — both popped from the top together', async () => {
  setStack('sheikh', 'live-A', 'live-B');
  await render(
    <>
      <Room routeKey="live-A" label="إغلاق المجلس السابق" />
      <Room routeKey="live-B" label="تصغير المجلس الجديد" />
    </>,
  );
  await fireEvent.press(screen.getByText('إغلاق المجلس السابق')); // A was left for B
  expectNoNavigation();

  await fireEvent.press(screen.getByText('تصغير المجلس الجديد'));
  expect(mockRouter.dismiss).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismiss).toHaveBeenCalledWith(2);
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('a covered room that did NOT ask to close stays when the room above closes', async () => {
  setStack('sheikh', 'live-A', 'live-B');
  await render(
    <>
      <Room routeKey="live-A" label="المجلس السابق" />
      <Room routeKey="live-B" label="العودة" />
    </>,
  );
  await fireEvent.press(screen.getByText('العودة')); // e.g. B not started yet — back to A
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismiss).not.toHaveBeenCalled();
});

test('uncovered later (a lecture player closed over it), the room closes then — once', async () => {
  setStack('sheikh', 'live-A', 'player');
  await render(<Room routeKey="live-A" label="إغلاق الحلقة" />);
  await fireEvent.press(screen.getByText('إغلاق الحلقة'));
  expectNoNavigation();

  setStack('sheikh', 'live-A'); // the player is dismissed
  await act(async () => mockFocus['live-A']?.());
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  await act(async () => mockFocus['live-A']?.()); // focused again: nothing pending
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('the room on top closes as before (back), or goes Home with no history', async () => {
  setStack('sheikh', 'live-A');
  await render(<Room routeKey="live-A" label="تصغير" />);
  await fireEvent.press(screen.getByText('تصغير'));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);

  setStack('live-A');
  mockRouter.canGoBack.mockReturnValue(false);
  await fireEvent.press(screen.getByText('تصغير'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

test('already removed from the stack: closing again touches nothing', async () => {
  setStack('sheikh', 'live-B');
  await render(<Room routeKey="live-A" label="إغلاق" />);
  await fireEvent.press(screen.getByText('إغلاق'));
  expectNoNavigation();
});
