import { View } from 'react-native';

import { colors } from '@/constants/theme';
import { Rhombus } from './Rhombus';

/** App logo: brass ring around a teal circle with a brass rhombus. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: colors.accentBrass,
        backgroundColor: colors.primaryTeal,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Rhombus size={size * 0.34} color={colors.accentBrass} />
    </View>
  );
}
