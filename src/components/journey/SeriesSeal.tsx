import { View, type ViewStyle } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { Rhombus } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';

/**
 * «تمّت بحمد الله» — the quiet brass-seal ribbon shown on a series once every
 * lesson in it is complete (V20 · Feature A). Reuses the tiered-badge seal
 * language (brass rhombus emblem, sand card) but as a compact inline ribbon that
 * sits on series cards (JourneyMap rows, the section page). Calm, non-competitive:
 * a small mark of completion, no confetti (CLAUDE.md tone).
 *
 * `variant`:
 *   - 'ribbon' (default) — a slim brass-tinted pill for cards.
 *   - 'block' — a fuller centred emblem for the section page / closing header.
 */
export function SeriesSeal({
  variant = 'ribbon',
  label = 'تمّت بحمد الله',
  style,
}: {
  variant?: 'ribbon' | 'block';
  label?: string;
  style?: ViewStyle;
}) {
  if (variant === 'block') {
    return (
      <View style={[{ alignItems: 'center', gap: 8 }, style]}>
        <View
          style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentBrass,
          }}
        >
          <Rhombus size={26} color={colors.surfaceCard} filled={false} />
          <Rhombus size={11} color={colors.surfaceCard} filled style={{ position: 'absolute' }} />
        </View>
        <Txt size={13} weight="semibold" color={colors.accentBrassMuted} align="center">
          {label}
        </Txt>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 6,
          paddingVertical: 4,
          paddingHorizontal: 10,
          borderRadius: radius.pill,
          backgroundColor: colors.bgSandRaised,
          borderWidth: 1,
          borderColor: colors.accentBrassSoft,
        },
        style,
      ]}
    >
      <Rhombus size={9} color={colors.accentBrass} filled />
      <Txt size={11.5} weight="semibold" color={colors.accentBrassMuted}>
        {label}
      </Txt>
    </View>
  );
}
