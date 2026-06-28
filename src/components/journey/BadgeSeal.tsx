import { View } from 'react-native';

import type { Badge } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { Rhombus } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';

/**
 * A milestone badge (Phase 2 · feature C). Earned = a quiet brass seal (a filled
 * brass rounded square with the rhombus motif); locked = a muted sand outline
 * with a hint of what unlocks it. No trophies, no glow — just a calm seal
 * (CLAUDE.md tone). The threshold hint never nags about being "behind".
 */
export function BadgeSeal({ badge }: { badge: Badge }) {
  const earned = badge.earned;
  const hint =
    badge.kind === 'completed'
      ? `أتمم ${arNum(badge.threshold)} دروس`
      : `داوم ${arNum(badge.threshold)} يوماً`;

  return (
    <View
      style={{
        width: '48%',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 16,
        paddingHorizontal: 10,
        borderRadius: radius.card,
        backgroundColor: earned ? colors.surfaceCard : colors.bgSandRaised,
        borderWidth: 1,
        borderColor: earned ? colors.accentBrassSoft : colors.borderSand,
      }}
    >
      {/* Seal emblem */}
      <View
        style={{
          width: 58,
          height: 58,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: earned ? colors.accentBrass : colors.surfaceInset,
          borderWidth: earned ? 0 : 1,
          borderColor: colors.borderSand2,
        }}
      >
        <Rhombus
          size={26}
          color={earned ? colors.primaryTealDeep : colors.textGhost}
          filled={false}
        />
        <Rhombus
          size={11}
          color={earned ? colors.primaryTealDeep : colors.textGhost}
          filled={earned}
          style={{ position: 'absolute' }}
        />
      </View>

      <Txt
        weight="semibold"
        size={13}
        align="center"
        numberOfLines={1}
        color={earned ? colors.textInk : colors.textFaint}
      >
        {badge.titleAr}
      </Txt>
      <Txt size={11} align="center" color={colors.textMuted} numberOfLines={2}>
        {earned ? badge.descAr : hint}
      </Txt>
    </View>
  );
}
