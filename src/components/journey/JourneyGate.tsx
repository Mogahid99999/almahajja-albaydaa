import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { colors, radius, shadows } from '@/constants/theme';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Guest gate for رحلتي العلمية (Task 3). The journey is the ONE feature reserved
 * for registered users — everything else (browsing, playback, resume, downloads,
 * notifications) stays open. This is a calm, non-gamified invitation, not a wall:
 * no pressure, no comparison, no counts.
 */
export function JourneyGate() {
  const router = useRouter();
  return (
    <View style={{ paddingTop: 24, alignItems: 'center' }}>
      <Card style={[{ padding: 24, alignItems: 'center', width: '100%' }, shadows.feature]}>
        {/* Calm emblem */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            borderWidth: 2,
            borderColor: colors.accentBrass,
            backgroundColor: colors.primaryTeal,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <Feather name="compass" size={26} color={colors.onTealPrimary} />
        </View>

        <Txt weight="display" size={19} color={colors.primaryTeal} align="center">
          سجّل لفتح رحلتك العلمية
        </Txt>
        <Txt
          size={13}
          color={colors.textMuted}
          align="center"
          style={{ marginTop: 10, lineHeight: 22 }}
        >
          تتبّع دروسك المكتملة وتقدّمك عبر أجهزتك، بهدوء ودون مقارنة مع أحد. يبقى كل ما بدأته
          محفوظًا معك.
        </Txt>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إنشاء حساب"
          onPress={() => router.push('/(auth)/register')}
          style={({ pressed }) => [
            {
              marginTop: 22,
              alignSelf: 'stretch',
              backgroundColor: colors.primaryTeal,
              borderRadius: radius.input,
              paddingVertical: 13,
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
            },
            shadows.button,
          ]}
        >
          <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
            إنشاء حساب
          </Txt>
        </Pressable>

        <Pressable
          hitSlop={8}
          onPress={() => router.push('/(auth)/sign-in')}
          style={{ marginTop: 16 }}
        >
          <Txt size={12.5} color={colors.textMuted}>
            لديك حساب؟{' '}
            <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
              تسجيل الدخول
            </Txt>
          </Txt>
        </Pressable>
      </Card>
    </View>
  );
}
