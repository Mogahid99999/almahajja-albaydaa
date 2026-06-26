import { View, type ViewStyle } from 'react-native';

import { colors, fonts, radius } from '@/constants/theme';
import { Rhombus } from './Rhombus';
import { Txt } from './Txt';

/**
 * Sheikh / meta chip — a simple rounded slip with an optional rhombus bullet.
 * Used for the sheikh names row above lecture lists (PRD §7).
 */
export function Chip({
  label,
  bullet = true,
  style,
}: {
  label: string;
  bullet?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: colors.surfaceWhite,
          borderColor: colors.borderSand,
          borderWidth: 1,
          borderRadius: radius.pill,
          paddingVertical: 7,
          paddingHorizontal: 12,
        },
        style,
      ]}
    >
      {bullet ? <Rhombus size={7} color={colors.accentBrassMuted} /> : null}
      <Txt size={12} weight="medium" color={colors.textSlate} style={{ fontFamily: fonts.bodyMedium }}>
        {label}
      </Txt>
    </View>
  );
}
