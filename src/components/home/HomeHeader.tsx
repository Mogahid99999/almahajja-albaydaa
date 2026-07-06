import { View } from 'react-native';

import { colors } from '@/constants/theme';
import { Logo, Txt } from '@/components/ui';

/**
 * Home screen top bar — logo + app title + subtitle.
 * The search/notifications/profile icons that used to live here have moved
 * to the bottom nav bar (see src/components/navigation/BottomNavBar.tsx).
 */
export function HomeHeader() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 18,
        paddingTop: 4,
      }}
    >
      {/* Right (RTL start): logo + title block */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <Logo size={40} />
        <View>
          <Txt weight="display" size={22} color={colors.primaryTeal} style={{ lineHeight: 26 }}>
            المَحجّة البَيْضَاء
          </Txt>
          <Txt size={11} color={colors.textGhost} style={{ marginTop: 3, letterSpacing: 0.2 }}>
            مجالس الدروس الشرعية
          </Txt>
        </View>
      </View>
    </View>
  );
}
