import { View } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * Small dot row marking scroll position under a horizontal rail (one dot per
 * "page" of cards). Verified on-device that a plain `flexDirection: 'row'`
 * View does NOT get auto-mirrored by native RTL here the way `ScrollView`'s
 * own RTL-aware scrolling does (confirmed: the rail's cards render correctly
 * right-to-left while a same-build `row` dot row rendered left-to-right) —
 * so `row-reverse` is hardcoded rather than derived from `I18nManager.isRTL`,
 * guaranteeing the first dot (page 0, where the rail starts) renders rightmost.
 */
export function PaginationDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;

  return (
    <View
      style={{
        flexDirection: 'row-reverse',
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
