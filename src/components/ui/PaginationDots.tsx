import { I18nManager, View } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * Small dot row marking scroll position under a horizontal rail (one dot per
 * "page" of cards). `I18nManager.isRTL` isn't reliably true in every runtime
 * this app ships to (see app/_layout.tsx's note on Expo Go), so the row
 * direction is picked explicitly rather than assumed from native mirroring —
 * the first dot (page 0, where the rail starts) always renders rightmost.
 */
export function PaginationDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;

  return (
    <View
      style={{
        flexDirection: I18nManager.isRTL ? 'row' : 'row-reverse',
        justifyContent: 'center',
        gap: 6,
        marginTop: 14,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === activeIndex ? 16 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i === activeIndex ? colors.accentBrass : colors.borderSand2,
          }}
        />
      ))}
    </View>
  );
}
