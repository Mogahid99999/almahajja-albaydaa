import { View, type ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * Horizontal progress track. RTL: the fill grows from the RIGHT edge (README).
 * Default brass fill; pass `tint="teal"` for the section-progress gradient look.
 */
export function ProgressBar({
  value,
  height = 7,
  tint = 'brass',
  trackColor = colors.surfaceTrack,
  style,
}: {
  /** 0..1 */
  value: number;
  height?: number;
  tint?: 'brass' | 'teal' | 'onTeal';
  trackColor?: string;
  style?: ViewStyle;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill =
    tint === 'teal'
      ? colors.primaryTeal600
      : tint === 'onTeal'
        ? colors.accentBrass
        : colors.accentBrass;
  return (
    <View
      style={[
        { height, backgroundColor: trackColor, borderRadius: height, overflow: 'hidden' },
        style,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          backgroundColor: fill,
          borderRadius: height,
        }}
      />
    </View>
  );
}
