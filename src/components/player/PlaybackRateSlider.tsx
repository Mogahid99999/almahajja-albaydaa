/**
 * Full-screen overlay shown while the speed chip (PlayerUtilityBar) is held.
 * Presentation only — the drag gesture lives on the chip itself; this just
 * renders the centered track/thumb/value bubble driven by shared values so
 * it tracks the finger at 60fps without bouncing through React state.
 */
import { Modal, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { RATE_MAX, RATE_MIN, RATE_STEP } from '@/stores/playerStore';
import { formatRate } from './rateFormat';

export const RATE_TRACK_WIDTH = 260;
const TRACK_HEIGHT = 6;
const THUMB_SIZE = 26;
const STEP_COUNT = Math.round((RATE_MAX - RATE_MIN) / RATE_STEP);

/**
 * Playback rate → x offset [0, RATE_TRACK_WIDTH] along the track.
 * Marked as a worklet — called from the gesture callbacks in
 * PlayerUtilityBar, which run on the UI thread, not just from JS.
 */
export function rateToTrackX(rate: number): number {
  'worklet';
  return ((rate - RATE_MIN) / (RATE_MAX - RATE_MIN)) * RATE_TRACK_WIDTH;
}

/** x offset along the track → the nearest valid (stepped, clamped) rate. Worklet (see above). */
export function trackXToRate(x: number): number {
  'worklet';
  const clampedX = Math.min(RATE_TRACK_WIDTH, Math.max(0, x));
  const raw = RATE_MIN + (clampedX / RATE_TRACK_WIDTH) * (RATE_MAX - RATE_MIN);
  const snapped = Math.round(raw / RATE_STEP) * RATE_STEP;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Number(snapped.toFixed(2))));
}

type Props = {
  visible: boolean;
  /** Thumb position along the track (px), animated on the UI thread by the caller's gesture. */
  trackX: SharedValue<number>;
  /** 0 → 1 pop-in progress, animated by the caller so open/close can be one spring. */
  progress: SharedValue<number>;
  /** Live rate label — kept as plain React state by the caller (only changes on step boundaries). */
  liveRate: number;
};

export function PlaybackRateSlider({ visible, trackX, progress, liveRate }: Props) {
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.85 + progress.value * 0.15 }],
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trackX.value - THUMB_SIZE / 2 }, { scale: 0.9 + progress.value * 0.1 }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: trackX.value,
  }));

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.backdrop} pointerEvents="none">
        <Animated.View style={[styles.card, cardStyle]}>
          <Txt size={34} weight="bold" color={colors.onTealPrimary} tabular style={styles.value}>
            {formatRate(liveRate)}
          </Txt>

          <View style={styles.trackWrap}>
            <View style={[styles.track, { width: RATE_TRACK_WIDTH }]}>
              <Animated.View style={[styles.trackFill, fillStyle]} />
              {/* Step ticks give a tactile sense of the 0.1 increments. */}
              {Array.from({ length: STEP_COUNT + 1 }).map((_, i) => (
                <View key={i} style={[styles.tick, { left: (RATE_TRACK_WIDTH / STEP_COUNT) * i }]} />
              ))}
            </View>
            <Animated.View style={[styles.thumb, thumbStyle]} />
          </View>

          <View style={styles.labelsRow}>
            <Txt size={11} color={colors.onTealSecondary} tabular>
              {formatRate(RATE_MIN)}
            </Txt>
            <Txt size={11} color={colors.onTealSecondary} tabular>
              {formatRate(RATE_MAX)}
            </Txt>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,30,27,0.45)',
  },
  card: {
    backgroundColor: colors.primaryTealDeep,
    borderRadius: 22,
    paddingVertical: 26,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  value: {
    marginBottom: 18,
    minWidth: 90,
    textAlign: 'center',
  },
  trackWrap: {
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  trackFill: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.accentBrass,
  },
  tick: {
    position: 'absolute',
    top: 0,
    width: 1.5,
    height: TRACK_HEIGHT,
    backgroundColor: 'rgba(15,30,27,0.28)',
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.accentBrass,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  labelsRow: {
    marginTop: 12,
    width: RATE_TRACK_WIDTH,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
