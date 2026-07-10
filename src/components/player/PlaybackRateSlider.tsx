/**
 * Inline playback-speed slider — sits directly under the lesson-tools row
 * (ملاحظاتي · الفوائد · الأسئلة · تحميل), track ~50% of the row's width.
 * Tap anywhere on the track to jump the rate there, or drag the thumb for
 * fine control (0.8×–2.0×, 0.1 steps). A small value bubble pops up above
 * the thumb only while actively dragging, and fades out on release.
 *
 * `direction: 'ltr'` is forced on the track's own container — this app is
 * globally RTL, which auto-mirrors flex layout (row → row-reverse) but NOT
 * the raw pixel math used for the thumb/fill position, so left unset the
 * two would disagree (min/max ends would visually swap relative to the
 * fill). Pinning this one small subtree to ltr keeps every part of the
 * slider's own coordinate system consistent, independent of the app's
 * writing direction — the same way a numeric slider stays LTR in other
 * RTL apps.
 */
import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { RATE_MAX, RATE_MIN, RATE_STEP } from '@/stores/playerStore';
import { formatRate } from './rateFormat';

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 18;
const HIT_ZONE_HEIGHT = 32;
const NORMAL_RATE = 1.0;
/** Extra "magnetic" radius (px) around the ×1 mark — makes normal speed easy
 * to land on exactly without needing pixel-perfect precision. While the finger
 * is inside this radius the THUMB itself also snaps onto the ×1 tick (not just
 * the reported rate), so ×1.0 visibly "catches" the drag. */
const NORMAL_SNAP_PX = 14;

function snapRate(raw: number): number {
  'worklet';
  const snapped = Math.round(raw / RATE_STEP) * RATE_STEP;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Number(snapped.toFixed(2))));
}

/** x offset within the track → nearest valid (stepped, clamped) rate. Worklet. */
function xToRate(x: number, width: number): number {
  'worklet';
  if (width <= 0) return RATE_MIN;
  const clampedX = Math.min(width, Math.max(0, x));
  const normalX = ((NORMAL_RATE - RATE_MIN) / (RATE_MAX - RATE_MIN)) * width;
  if (Math.abs(clampedX - normalX) < NORMAL_SNAP_PX) {
    return NORMAL_RATE;
  }
  return snapRate(RATE_MIN + (clampedX / width) * (RATE_MAX - RATE_MIN));
}

/** Playback rate → x offset within the track. Worklet. */
function rateToX(rate: number, width: number): number {
  'worklet';
  return ((rate - RATE_MIN) / (RATE_MAX - RATE_MIN)) * width;
}

type Props = {
  rate: number;
  onCommit: (rate: number) => void;
};

export function PlaybackRateSlider({ rate, onCommit }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [bubbleRate, setBubbleRate] = useState(rate);

  // Thumb position (px) and drag progress (0 idle → 1 dragging, drives the
  // bubble's fade/scale) — both live on the UI thread; only the bubble's
  // *text* needs to cross back to JS, and only when the snapped value changes.
  const thumbX = useSharedValue(0);
  const dragProgress = useSharedValue(0);
  const lastEmitted = useSharedValue(rate);

  function handleLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    thumbX.value = rateToX(rate, w);
  }

  // Static tick marking the ×1 (normal) speed — drawn once trackWidth is known.
  const normalMarkerX = rateToX(NORMAL_RATE, trackWidth);

  function updateBubble(next: number) {
    setBubbleRate(next);
  }

  const dragGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const x = Math.min(trackWidth, Math.max(0, e.x));
      const startRate = xToRate(x, trackWidth);
      // Magnetic ×1: while the touch is in the snap zone the thumb rides the
      // ×1 tick itself, so normal speed "catches" instead of needing precision.
      thumbX.value = startRate === NORMAL_RATE ? rateToX(NORMAL_RATE, trackWidth) : x;
      lastEmitted.value = startRate;
      dragProgress.value = withSpring(1, { damping: 16, stiffness: 250 });
      runOnJS(updateBubble)(startRate);
    })
    .onUpdate((e) => {
      const x = Math.min(trackWidth, Math.max(0, e.x));
      const nextRate = xToRate(x, trackWidth);
      thumbX.value = nextRate === NORMAL_RATE ? rateToX(NORMAL_RATE, trackWidth) : x;
      if (nextRate !== lastEmitted.value) {
        lastEmitted.value = nextRate;
        runOnJS(updateBubble)(nextRate);
      }
    })
    .onEnd(() => {
      const finalRate = xToRate(thumbX.value, trackWidth);
      // Settle the thumb onto the committed (stepped) rate's exact position so
      // the visual never disagrees with the actual playback speed.
      thumbX.value = withTiming(rateToX(finalRate, trackWidth), { duration: 120 });
      runOnJS(onCommit)(finalRate);
      dragProgress.value = withTiming(0, { duration: 160 });
    })
    .onFinalize((_e, success) => {
      if (!success) {
        dragProgress.value = withTiming(0, { duration: 160 });
      }
    });

  const fillStyle = useAnimatedStyle(() => ({ width: thumbX.value }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: thumbX.value - THUMB_SIZE / 2 },
      { scale: 1 + dragProgress.value * 0.2 },
    ],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: dragProgress.value,
    transform: [
      { translateX: thumbX.value - 22 },
      { translateY: -30 - dragProgress.value * 6 },
      { scale: 0.85 + dragProgress.value * 0.15 },
    ],
  }));

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={dragGesture}>
        <View
          onLayout={handleLayout}
          style={styles.hitZone}
          accessibilityRole="adjustable"
          accessibilityLabel={`سرعة التشغيل ${formatRate(rate)}`}
        >
          <View style={styles.track}>
            <Animated.View style={[styles.trackFill, fillStyle]} />
          </View>
          {trackWidth > 0 ? (
            <View
              pointerEvents="none"
              style={[styles.normalMark, { transform: [{ translateX: normalMarkerX }] }]}
            />
          ) : null}
          <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
          <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
            <Txt size={12} weight="semibold" color={colors.primaryTealDeep} tabular align="center">
              {formatRate(bubbleRate)}
            </Txt>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '50%',
    alignSelf: 'center',
    direction: 'ltr',
  },
  hitZone: {
    height: HIT_ZONE_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  trackFill: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.accentBrass,
  },
  // A short vertical line crossing the track at the ×1 (normal-speed) point.
  normalMark: {
    position: 'absolute',
    left: -1,
    top: (HIT_ZONE_HEIGHT - 12) / 2,
    width: 2,
    height: 12,
    borderRadius: 1,
    backgroundColor: 'rgba(246,240,226,0.55)',
  },
  thumb: {
    position: 'absolute',
    left: 0,
    top: (HIT_ZONE_HEIGHT - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.accentBrass,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  bubble: {
    position: 'absolute',
    left: 0,
    top: 0,
    minWidth: 44,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.accentBrass,
    alignItems: 'center',
  },
});
