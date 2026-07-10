import { View } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * Small dot row marking scroll position under a horizontal rail (one dot per
 * "page" of cards). Native RTL mirroring (see app/_layout.tsx) flips the row
 * automatically, so the active dot always lands on the same side the rail's
 * first page opens on — no RTL-specific styling needed here.
 */
export function PaginationDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 }}>
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
