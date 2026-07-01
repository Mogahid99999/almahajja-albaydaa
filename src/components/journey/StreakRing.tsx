import { View } from 'react-native';

import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { ConcentricMotif } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';

/**
 * مداومة — a calm streak ring (Phase 2 · feature C).
 *
 * Deliberately *not* a gamified flame or pressure meter (CLAUDE.md calm tone):
 * a teal disc with a quiet brass ring + faint concentric motif, the day count
 * centred, and the longest streak noted below so a missed day never erases an
 * achievement. No "don't break your streak!" copy.
 */
export function StreakRing({
  current,
  longest,
  size = 132,
}: {
  current: number;
  longest: number;
  size?: number;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
          borderColor: colors.accentBrass,
          backgroundColor: colors.primaryTeal,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <ConcentricMotif
          size={size}
          rings={3}
          color="rgba(201,164,99,0.16)"
          style={{ top: 0, left: 0 }}
        />
        <Txt weight="display" size={44} color={colors.onTealPrimary} align="center" centerGlyph>
          {arNum(current)}
        </Txt>
        <Txt size={12} color={colors.onTealSecondary} align="center">
          {current === 0 ? 'ابدأ اليوم' : 'يوم مداومة'}
        </Txt>
      </View>

      <Txt size={12.5} color={colors.textMuted} align="center">
        {`أطول مداومة: ${arNum(longest)} ${longest === 1 ? 'يوم' : 'يوماً'}`}
      </Txt>
    </View>
  );
}
