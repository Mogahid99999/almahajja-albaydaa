/**
 * Waveform — ~48 thin vertical bars representing the audio waveform.
 * Played portion is brass (#c9a463); unplayed is faint white-teal.
 * Tap anywhere to seek: fraction computed from touch x / container width.
 */
import { I18nManager, Pressable, View, type LayoutChangeEvent } from 'react-native';
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
  const containerWidthRef = useRef<number>(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const playedFraction = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;
  const playedCount = Math.round(BAR_HEIGHTS.length * playedFraction);

  function handleLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    containerWidthRef.current = w;
    setContainerWidth(w);
  }

  function handlePress(e: { nativeEvent: { locationX: number } }) {
    const w = containerWidthRef.current;
    if (w <= 0 || durationSec <= 0) return;
    // `locationX` is measured from the physical left, but under global RTL the
    // bars render right-to-left (0s on the right). Mirror so a tap lands on the
    // time under the finger instead of its horizontal reflection.
    const raw = Math.min(1, Math.max(0, e.nativeEvent.locationX / w));
    const fraction = I18nManager.isRTL ? 1 - raw : raw;
    onSeek(fraction * durationSec);
  }

  return (
    <View>
      <Pressable
        onLayout={handleLayout}
        onPress={handlePress}
        accessibilityRole="adjustable"
        accessibilityLabel="شريط التقدم"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2.5,
          height: 48,
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
      </Pressable>

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
          {arDuration(positionSec)}
        </Txt>
      </View>
    </View>
  );
}
