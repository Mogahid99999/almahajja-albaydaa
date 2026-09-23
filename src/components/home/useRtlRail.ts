import { useCallback, useRef, useState } from 'react';
import {
  I18nManager,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  type ScrollView,
} from 'react-native';

/**
 * RTL horizontal-rail behaviour that stays tappable on iOS.
 *
 * iOS 17's native RTL horizontal `ScrollView` mirrors its content with a
 * transform, which leaves the responder system hit-testing against flipped
 * geometry: the scroll view's pan gesture keeps winning the negotiation, so
 * child `Pressable` cards need two or three taps before `onPress` fires.
 *
 * The fix is to NOT use native RTL scrolling at all. We force the ScrollView to
 * `direction: 'ltr'` (see `railStyle`) so hit-testing stays in stable,
 * un-mirrored geometry, then re-create the RTL look ourselves:
 *   - cards are laid out `row-reverse` (index 0 renders rightmost),
 *   - the viewport is scrolled to the right edge on mount (`onContentSizeChange`),
 *     so the first card is what the user sees and they scroll leftward — RTL feel.
 *
 * Because the scroll axis is now plain LTR, `contentOffset.x` counts up from the
 * LEFT. `pageFromOffset` converts that back into a right-origin page index so
 * the pagination dots still track "page 0 = rightmost".
 *
 * Android and web are unaffected by the iOS transform bug, so there we leave the
 * platform's own RTL scrolling in place (no forced direction, no manual offset).
 */
export function useRtlRail(pageWidth: number, pageCount: number) {
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState(0);
  const contentWidthRef = useRef(0);

  // Only take over RTL scrolling on iOS-in-RTL; elsewhere behave natively.
  const manualRtl = Platform.OS === 'ios' && I18nManager.isRTL;

  const onContentSizeChange = useCallback(
    (w: number) => {
      contentWidthRef.current = w;
      if (manualRtl) {
        // Jump to the right edge so the first (index 0) card is visible.
        scrollRef.current?.scrollTo({ x: w, animated: false });
      }
    },
    [manualRtl],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement } = e.nativeEvent;
      let page: number;
      if (manualRtl) {
        // LTR offset → distance from the RIGHT edge → right-origin page index.
        const fromRight =
          contentWidthRef.current - layoutMeasurement.width - contentOffset.x;
        page = Math.round(fromRight / pageWidth);
      } else {
        page = Math.round(contentOffset.x / pageWidth);
      }
      setActivePage(Math.max(0, Math.min(page, pageCount - 1)));
    },
    [manualRtl, pageWidth, pageCount],
  );

  return {
    scrollRef,
    activePage,
    handleScroll,
    onContentSizeChange,
    /** Spread onto the horizontal ScrollView. `ltr` kills the buggy iOS transform. */
    railStyle: manualRtl ? ({ direction: 'ltr' } as const) : undefined,
    /** Spread into contentContainerStyle so cards render right-to-left under LTR. */
    railContentStyle: manualRtl ? ({ flexDirection: 'row-reverse' } as const) : undefined,
  };
}

/**
 * Same iOS-17 tap fix as {@link useRtlRail} but for simple horizontal chip/tab
 * strips that have no pagination and no meaningful scroll-position tracking.
 * Forces `direction: 'ltr'` (so child `Pressable`s hit-test correctly) and
 * re-creates the RTL chip order with `row-reverse`. No-op off iOS-in-RTL.
 *
 * Returns styles to spread onto the ScrollView and its contentContainerStyle.
 */
export function rtlStripStyles() {
  const manualRtl = Platform.OS === 'ios' && I18nManager.isRTL;
  return {
    stripStyle: manualRtl ? ({ direction: 'ltr' } as const) : undefined,
    stripContentStyle: manualRtl ? ({ flexDirection: 'row-reverse' as const } as const) : undefined,
  };
}
