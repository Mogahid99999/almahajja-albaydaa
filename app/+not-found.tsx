import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Logo } from '@/components/ui/Logo';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';

/**
 * Unmatched-route screen. Reached only from a bad link — a malformed external
 * `riwaqalilm://…` deep link, a stale notification payload, or a mistyped web
 * URL. Without this file expo-router renders its built-in English "Unmatched
 * Route" screen, which breaks the Arabic-first identity. Calm and quiet:
 * explain, offer the way home, no error styling.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bgSand,
        padding: 32,
        gap: 20,
      }}
    >
      <Logo size={84} />
      <Txt weight="display" size={22} color={colors.primaryTeal} align="center">
        الصفحة غير موجودة
      </Txt>
      <Txt size={14} color={colors.textMuted} align="center" style={{ lineHeight: 24 }}>
        الرابط الذي فتحته لم يعد متاحًا أو غير صحيح.
      </Txt>
      <Pressable
        onPress={() => router.replace('/')}
        accessibilityRole="button"
        style={({ pressed }) => ({
          backgroundColor: colors.primaryTeal,
          paddingHorizontal: 28,
          paddingVertical: 14,
          borderRadius: radius.input,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
          العودة إلى الرئيسية
        </Txt>
      </Pressable>
    </View>
  );
}
