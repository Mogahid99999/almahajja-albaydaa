/**
 * Swipe-only RTL pager: the NEXT page waits on the LEFT, so dragging the page
 * to the right turns forward (as in a printed mushaf). Three slots (previous,
 * current, next) are mounted at a time.
 *
 * Gesture arbitration (approved in the prototype):
 *   - a pan becomes a page turn only once it is clearly horizontal; in the
 *     enlarged mode (vertical scrolling text) it must be MORE clearly sideways,
 *     so a slightly diagonal scroll never nudges the page;
 *   - vertical movement fails the pan, leaving the page's own ScrollView
 *     (gesture-handler's, so the two arbitrate natively) to scroll with momentum;
 *   - a tap toggles the reading chrome.
 *
 * Slot positions are derived on the UI thread from (offset, base page), and the
 * commit swaps both in the same frame, so a turn never flickers.
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { PAGE_COUNT } from '@/mushaf/quran';

const TURN_MS = 260;

function Slot({
  page,
  base,
  offset,
  width,
  children,
}: {
  page: number;
  base: SharedValue<number>;
  offset: SharedValue<number>;
  width: number;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value - (page - base.value) * width }],
  }));
  return <Animated.View style={[StyleSheet.absoluteFill, { width }, style]}>{children}</Animated.View>;
}

export function MushafPager({
  page,
  width,
  height,
  strictHorizontal,
  onPageChange,
  onTap,
  onTurnStart,
  renderPage,
}: {
  page: number;
  width: number;
  height: number;
  /** Enlarged (scrolling) mode: require a clearly sideways swipe to turn. */
  strictHorizontal: boolean;
  onPageChange: (page: number) => void;
  onTap: () => void;
  onTurnStart?: () => void;
  renderPage: (page: number) => ReactNode;
}) {
  const offset = useSharedValue(0);
  const base = useSharedValue(page);

  // External jumps (index, search, bookmark) — not a swipe.
  useEffect(() => {
    if (base.value !== page) {
      base.value = page;
      offset.value = 0;
    }
  }, [page, base, offset]);

  const commit = (target: number) => onPageChange(target);

  const pan = Gesture.Pan()
    .activeOffsetX(strictHorizontal ? [-24, 24] : [-12, 12])
    .failOffsetY(strictHorizontal ? [-12, 12] : [-24, 24])
    .onStart(() => {
      if (onTurnStart) runOnJS(onTurnStart)();
    })
    .onUpdate((e) => {
      const p = base.value;
      let dx = e.translationX;
      // Resistance at the first / last page.
      if ((dx > 0 && p >= PAGE_COUNT) || (dx < 0 && p <= 1)) dx *= 0.25;
      offset.value = dx;
    })
    .onEnd((e) => {
      const p = base.value;
      const dx = e.translationX;
      const fast = Math.abs(e.velocityX) > 450 && Math.abs(dx) > 30;
      const dir = dx > width * 0.2 || (fast && dx > 0) ? 1 : dx < -width * 0.2 || (fast && dx < 0) ? -1 : 0;
      const target = p + dir;
      if (dir === 0 || target < 1 || target > PAGE_COUNT) {
        offset.value = withTiming(0, { duration: 180 });
        return;
      }
      offset.value = withTiming(dir * width, { duration: TURN_MS }, (finished) => {
        if (!finished) return;
        base.value = target;
        offset.value = 0;
        runOnJS(commit)(target);
      });
    });

  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((_e, ok) => {
      if (ok) runOnJS(onTap)();
    });

  const pages = [page - 1, page, page + 1].filter((p) => p >= 1 && p <= PAGE_COUNT);

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        style={{ width, height, overflow: 'hidden' }}
        accessible
        accessibilityLabel="صفحات المصحف — اسحب يميناً للصفحة التالية"
        accessibilityActions={[
          { name: 'increment', label: 'الصفحة التالية' },
          { name: 'decrement', label: 'الصفحة السابقة' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment' && page < PAGE_COUNT) onPageChange(page + 1);
          if (e.nativeEvent.actionName === 'decrement' && page > 1) onPageChange(page - 1);
        }}
      >
        {pages.map((p) => (
          <Slot key={p} page={p} base={base} offset={offset} width={width}>
            {renderPage(p)}
          </Slot>
        ))}
      </View>
    </GestureDetector>
  );
}
