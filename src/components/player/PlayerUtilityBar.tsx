/**
 * Bottom utility bar (absolute-positioned, 26px from bottom).
 * Speed chip always shows the current rate (e.g. "١٫٠×"). Press and hold it
 * to drag a slider (0.8×–2.0×, 0.1 steps) that pops up centered on screen —
 * the finger's horizontal movement (not its absolute position) drives the
 * thumb, so the drag can wander anywhere on screen once it starts. Release
 * to commit the rate; the overlay springs back out.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { setRate } from '@/lib/audioController';
import { type PlaybackRate } from '@/stores/playerStore';
import { PlaybackRateSlider, RATE_TRACK_WIDTH, rateToTrackX, trackXToRate } from './PlaybackRateSlider';
import { formatRate } from './rateFormat';

const CHIP_BG = 'rgba(255,255,255,0.07)';
const CHIP_BG_ACTIVE = 'rgba(255,255,255,0.14)';
const CHIP_RADIUS = 14;
const CHIP_PADDING_V = 11;
const CHIP_PADDING_H = 15;

type Props = {
  lectureId: string;
  rate: PlaybackRate;
};

export function PlayerUtilityBar({ lectureId, rate }: Props) {
  const insets = useSafeAreaInsets();

  const [sliderVisible, setSliderVisible] = useState(false);
  const [liveRate, setLiveRate] = useState(rate);
  const [chipActive, setChipActive] = useState(false);

  // Track position (px) and pop-in progress (0→1) driven straight from the
  // gesture worklet on the UI thread — the overlay just reads these.
  const trackX = useSharedValue(rateToTrackX(rate));
  const progress = useSharedValue(0);
  // Where the drag started, and the last rate reported to JS (to only cross
  // the bridge when the snapped value actually changes, not every pixel).
  const baseX = useSharedValue(0);
  const lastEmitted = useSharedValue(rate);

  function openSlider(atRate: number) {
    setChipActive(true);
    setSliderVisible(true);
    setLiveRate(atRate);
  }

  function updateLiveRate(next: number) {
    setLiveRate(next);
  }

  function commitRate(next: number) {
    setRate(next as PlaybackRate);
    setChipActive(false);
  }

  function closeSlider() {
    setSliderVisible(false);
  }

  // Rebuilt each render, so `rate` in this closure is always the latest
  // committed value — no need to thread it through a ref (unsafe to read a
  // plain ref's `.current` from a UI-thread worklet; only shared values and
  // captured primitives like this are cross-thread safe).
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(220)
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      baseX.value = rateToTrackX(rate);
      trackX.value = baseX.value;
      lastEmitted.value = rate;
      progress.value = withSpring(1, { damping: 16, stiffness: 220 });
      runOnJS(openSlider)(rate);
    })
    .onUpdate((e) => {
      const nextX = Math.min(RATE_TRACK_WIDTH, Math.max(0, baseX.value + e.translationX));
      trackX.value = nextX;
      const nextRate = trackXToRate(nextX);
      if (nextRate !== lastEmitted.value) {
        lastEmitted.value = nextRate;
        runOnJS(updateLiveRate)(nextRate);
      }
    })
    .onEnd(() => {
      const finalRate = trackXToRate(trackX.value);
      runOnJS(commitRate)(finalRate);
      progress.value = withTiming(0, { duration: 160 }, (finished) => {
        if (finished) runOnJS(closeSlider)();
      });
    })
    .onFinalize((_e, success) => {
      // Safety net: a cancelled/interrupted gesture (e.g. an OS alert) still
      // has to close the overlay and restore the previous rate.
      if (!success) {
        runOnJS(commitRate)(rate);
        progress.value = withTiming(0, { duration: 160 }, (finished) => {
          if (finished) runOnJS(closeSlider)();
        });
      }
    });

  const chipStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(chipActive ? 1.04 : 1, { damping: 14, stiffness: 260 }) }],
  }));

  return (
    <View
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        // Sit above the system nav bar / gesture area (Issue 2).
        bottom: 26 + insets.bottom,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      {/* Speed chip — press and hold to drag the rate slider open. */}
      <GestureDetector gesture={dragGesture}>
        <Animated.View
          accessibilityRole="adjustable"
          accessibilityLabel={`سرعة التشغيل ${formatRate(rate)}، اضغط مطولاً لتغييرها`}
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              backgroundColor: chipActive ? CHIP_BG_ACTIVE : CHIP_BG,
              borderRadius: CHIP_RADIUS,
              paddingVertical: CHIP_PADDING_V,
              paddingHorizontal: CHIP_PADDING_H,
            },
            chipStyle,
          ]}
        >
          <Feather name="clock" size={16} color={colors.accentBrass} />
          <Txt
            size={13}
            color={colors.onTealPrimary}
            weight="semibold"
            tabular
            style={{ minWidth: 30, textAlign: 'center' }}
          >
            {formatRate(rate)}
          </Txt>
        </Animated.View>
      </GestureDetector>

      <PlaybackRateSlider
        visible={sliderVisible}
        trackX={trackX}
        progress={progress}
        liveRate={liveRate}
      />
    </View>
  );
}
