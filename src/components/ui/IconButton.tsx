import Feather from '@expo/vector-icons/Feather';
import { Pressable, type ViewStyle } from 'react-native';

import { colors, radius } from '@/constants/theme';

type FeatherName = keyof typeof Feather.glyphMap;

/**
 * Square icon button with a ≥44px tap target (README › tap targets). Inset sand
 * background by default; pass `variant="ghost"` for a transparent hit area or
 * `variant="teal"`/`"brass"` for accented round buttons.
 */
export function IconButton({
  icon,
  onPress,
  size = 40,
  iconSize = 20,
  variant = 'inset',
  color,
  style,
  accessibilityLabel,
}: {
  icon: FeatherName;
  onPress?: () => void;
  size?: number;
  iconSize?: number;
  variant?: 'inset' | 'ghost' | 'teal' | 'brass';
  color?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const bg =
    variant === 'inset'
      ? colors.surfaceInset
      : variant === 'teal'
        ? colors.primaryTeal
        : variant === 'brass'
          ? colors.accentBrass
          : 'transparent';
  const stroke =
    color ??
    (variant === 'teal'
      ? colors.onTealIcon
      : variant === 'brass'
        ? colors.primaryTealDeep
        : colors.textMuted);
  const round = variant === 'teal' || variant === 'brass';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: round ? size / 2 : radius.input,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Feather name={icon} size={iconSize} color={stroke} />
    </Pressable>
  );
}
