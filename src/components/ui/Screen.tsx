import type { ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

/**
 * Sand-background screen wrapper. Applies safe-area top inset and 22px mobile
 * side padding. Use `scroll` for vertical scroll screens; `bottomPad` clears the
 * fixed mini-player (~118px on Home/Section).
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  bottomPad = 24,
  background = colors.bgSand,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  bottomPad?: number;
  background?: string;
  contentStyle?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: insets.top + 8,
    paddingHorizontal: padded ? spacing.screenH : 0,
    paddingBottom: bottomPad + insets.bottom,
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: background }, padding, contentStyle]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: background }}
      contentContainerStyle={[padding, contentStyle]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}
