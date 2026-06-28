import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { colors } from '@/constants/theme';
import { useUnreadCount } from '@/hooks/useNotifications';
import { IconButton, Logo, Txt } from '@/components/ui';

/**
 * Home screen top bar.
 * Right side: Logo + app title + subtitle (RTL so this is the leading/start side).
 * Left side: search and account icon buttons.
 */
export function HomeHeader() {
  const router = useRouter();
  const unread = useUnreadCount();

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
            رِواق العِلم
          </Txt>
          <Txt size={11} color={colors.textGhost} style={{ marginTop: 3, letterSpacing: 0.2 }}>
            مجالس الدروس الشرعية
          </Txt>
        </View>
      </View>

      {/* Left (RTL end): action buttons */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Notifications bell with a single quiet brass unread dot — no count */}
        <View>
          <IconButton
            icon="bell"
            variant="inset"
            size={40}
            iconSize={18}
            accessibilityLabel="الإشعارات"
            onPress={() => router.push('/(student)/notifications')}
          />
          {unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: 7,
                left: 7,
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: colors.accentBrass,
                borderWidth: 1.5,
                borderColor: colors.bgSand,
              }}
            />
          ) : null}
        </View>
        <IconButton
          icon="search"
          variant="inset"
          size={40}
          iconSize={18}
          accessibilityLabel="بحث"
        />
        <IconButton
          icon="user"
          variant="inset"
          size={40}
          iconSize={18}
          accessibilityLabel="الملف الشخصي"
          onPress={() => router.push('/profile')}
        />
      </View>
    </View>
  );
}
