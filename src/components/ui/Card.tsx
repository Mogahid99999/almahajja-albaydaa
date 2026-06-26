import { View, type ViewProps, type ViewStyle } from 'react-native';

import { colors, radius } from '@/constants/theme';

/** Standard sand card: `surface/card` bg, 1px `border/sand`, 18px radius. */
export function Card({
  style,
  padded = true,
  ...rest
}: ViewProps & { padded?: boolean; style?: ViewStyle | ViewStyle[] }) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surfaceCard,
          borderColor: colors.borderSand,
          borderWidth: 1,
          borderRadius: radius.card,
          ...(padded ? { padding: 16 } : null),
        },
        style as ViewStyle,
      ]}
      {...rest}
    />
  );
}
