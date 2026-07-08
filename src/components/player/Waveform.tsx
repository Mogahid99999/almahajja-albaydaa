/**
 * Waveform — ~48 thin vertical bars representing the audio waveform.
 * Played portion is brass (#c9a463); unplayed is faint white-teal.
 *
 * Draggable scrubber (Issue 7): tap anywhere to seek, OR press-and-drag for fine
 * seeking. While dragging, the bars + the time label track the finger live and
 * the actual `onSeek` is committed on release (so we don't fire dozens of seeks
 * mid-drag). Fraction is computed from touch x / container width, mirrored under
 * global RTL so a tap lands on the time under the finger.
 *
 * Uses `pageX` (absolute screen coordinate) minus the container's own measured
 * offset — NOT `nativeEvent.locationX`. On a move event RN reports `locationX`
 * relative to whichever child view is currently under the finger, not the
 * responder that granted the gesture; since the row is 48 separate sibling
 * bars (~6-8px each), locationX reset to a near-0 range every time the finger
 * crossed a bar boundary, making a long drag land on an essentially random
 * position (reported: dragging between minutes jumps to the wrong second).
 */
import {
  I18nManager,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useRef, useState } from 'react';

import { arDuration } from '@/lib/format';
import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';

// A calm pseudo-random bar height set (mirrors the design reference).
const BAR_HEIGHTS = [
  10, 16, 22, 14, 26, 32, 20, 12, 18, 28, 34, 24, 16, 22, 30, 40, 28, 18, 12, 20, 26, 36, 30, 22,
  14, 24, 32, 26, 18, 28, 38, 30, 20, 14, 22, 30, 24, 16, 26, 34, 22, 14, 18, 28, 20, 12, 16, 10,
];

type Props = {
  positionSec: number;
  durationSec: number;
  onSeek: (positionSec: number) => void;
};

export function Waveform({ positionSec, durationSec, onSeek }: Props) {
  const containerRef = useRef<View>(null);
  const containerWidthRef = useRef<number>(0);
  const containerPageXRef = useRef<number>(0);
  // Live fraction while a drag is in progress (null = not dragging → follow
  // playback position). Keeps the bars + time label under the finger.
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const playFraction = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;
  const shownFraction = dragFraction ?? playFraction;
  const playedCount = Math.round(BAR_HEIGHTS.length * shownFraction);
  const shownPositionSec = dragFraction != null ? dragFraction * durationSec : positionSec;

  function measureContainer() {
    containerRef.current?.measure((_x, _y, _w, _h, pageX) => {
      containerPageXRef.current = pageX;
    });
  }

  function handleLayout(e: LayoutChangeEvent) {
    containerWidthRef.current = e.nativeEvent.layout.width;
    measureContainer();
  }

  /** Absolute screen x → playback fraction [0,1], mirrored under global RTL (0s on right). */
  function fractionFromPageX(pageX: number): number {
    const w = containerWidthRef.current;
    if (w <= 0) return 0;
    const raw = Math.min(1, Math.max(0, (pageX - containerPageXRef.current) / w));
    return I18nManager.isRTL ? 1 - raw : raw;
  }

  function onGrant(e: GestureResponderEvent) {
    if (durationSec <= 0) return;
    // Re-measure in case layout shifted since the last onLayout — this is the
    // fix (see file header): pageX + a fresh absolute offset, never locationX.
    measureContainer();
    setDragFraction(fractionFromPageX(e.nativeEvent.pageX));
  }
  function onMove(e: GestureResponderEvent) {
    if (durationSec <= 0) return;
    setDragFraction(fractionFromPageX(e.nativeEvent.pageX));
  }
  function onRelease(e: GestureResponderEvent) {
    if (durationSec <= 0) {
      setDragFraction(null);
      return;
    }
    const fraction = fractionFromPageX(e.nativeEvent.pageX);
    setDragFraction(null);
    onSeek(fraction * durationSec);
  }

  return (
    <View>
      <View
        ref={containerRef}
        onLayout={handleLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={() => setDragFraction(null)}
        accessibilityRole="adjustable"
        accessibilityLabel="شريط التقدم"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2.5,
          height: 48,
          // Taller invisible touch zone so fine dragging is comfortable.
          paddingVertical: 10,
        }}
      >
        {BAR_HEIGHTS.map((h, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: h,
              borderRadius: 2,
              backgroundColor:
                i < playedCount ? colors.accentBrass : 'rgba(223,231,227,0.22)',
              minWidth: 2,
            }}
          />
        ))}
      </View>

      {/* Time row below bars */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 10,
        }}
      >
        <Txt
          size={12}
          color={colors.onTealSecondary}
          tabular
          weight="semibold"
        >
          {arDuration(durationSec)}
        </Txt>
        <Txt
          size={12}
          color={colors.accentBrass}
          tabular
          weight="semibold"
        >
          {arDuration(shownPositionSec)}
        </Txt>
      </View>
    </View>
  );
}
