import { View, type ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * The brand mark: a rotated square (rhombus). Used as logo glyph, list bullets,
 * status dots, and emblem fills. Drawn in views — never imagery (README › motif).
 */
export function Rhombus({
  size = 10,
  color = colors.accentBrass,
  filled = true,
  style,
}: {
  size?: number;
  color?: string;
  filled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          transform: [{ rotate: '45deg' }],
          backgroundColor: filled ? color : 'transparent',
          borderWidth: filled ? 0 : 1.5,
          borderColor: color,
          borderRadius: 1,
        },
        style,
      ]}
    />
  );
}

/**
 * Faint concentric circles — the decorative language on teal surfaces (feature
 * card, player, artwork). Absolutely positioned; render behind content.
 */
export function ConcentricMotif({
  size = 220,
  color = 'rgba(255,255,255,0.05)',
  rings = 4,
  style,
}: {
  size?: number;
  color?: string;
  rings?: number;
  style?: ViewStyle;
}) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', opacity: 1 }, style]}>
      {Array.from({ length: rings }).map((_, i) => {
        const d = size * (1 - i / (rings + 1));
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: 1,
              borderColor: color,
              left: (size - d) / 2,
              top: (size - d) / 2,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * Artwork emblem tile: deep-teal rounded square with nested brass rhombi.
 * Stands in for cover imagery on the feature card, player, and lecture covers.
 */
export function RhombusEmblem({
  size = 62,
  radius = 14,
  tile = colors.primaryTealDeep,
}: {
  size?: number;
  radius?: number;
  tile?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: tile,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Rhombus size={size * 0.42} color={colors.accentBrass} filled={false} />
      <Rhombus
        size={size * 0.2}
        color={colors.accentBrass}
        style={{ position: 'absolute' }}
      />
    </View>
  );
}
