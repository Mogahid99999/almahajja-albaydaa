import type { ViewStyle } from 'react-native';

import { colors, radius } from '@/constants/theme';

/**
 * Per-row border/radius so a FlatList's rows read as one bordered Card
 * (matching the old `<Card padded={false}>{items.map(...)}</Card>` look)
 * without wrapping the whole FlatList — needed because ListHeaderComponent/
 * ListFooterComponent content must stay outside the card's border.
 * Pair with `ItemSeparatorComponent={Divider}` for the inner hairlines.
 */
export function cardRowStyle(isFirst: boolean, isLast: boolean): ViewStyle {
  return {
    backgroundColor: colors.surfaceCard,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.borderSand,
    ...(isFirst
      ? { borderTopWidth: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }
      : null),
    ...(isLast
      ? {
          borderBottomWidth: 1,
          borderBottomLeftRadius: radius.card,
          borderBottomRightRadius: radius.card,
        }
      : null),
  };
}
