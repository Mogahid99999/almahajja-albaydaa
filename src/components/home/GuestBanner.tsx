import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useSettingsStore } from '@/stores/settingsStore';
import { Txt } from '@/components/ui/Txt';

/**
 * Gentle, dismissible Home banner inviting guests to register (Task 3). Calm and
 * non-gamified — no pressure, no counts. Shows only for a guest who hasn't
 * dismissed it; tapping opens registration, the × hides it for good (persisted).
 */
export function GuestBanner() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const dismissed = useSettingsStore((s) => s.guestBannerDismissed);
  const setDismissed = useSettingsStore((s) => s.setGuestBannerDismissed);

  if (!isGuest || dismissed) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="سجّل لتتبّع تقدّمك"
      onPress={() => router.push('/(auth)/register')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: radius.card,
        backgroundColor: 'rgba(31,74,66,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(31,74,66,0.12)',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Leading emblem */}
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: colors.primaryTeal,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="bookmark" size={16} color={colors.onTealPrimary} />
      </View>

      {/* Text */}
      <View style={{ flex: 1 }}>
        <Txt size={13.5} weight="semibold" color={colors.primaryTeal}>
          سجّل لتتبّع تقدّمك
        </Txt>
        <Txt size={11.5} color={colors.textMuted} style={{ marginTop: 2 }}>
          احفظ رحلتك العلمية عبر أجهزتك
        </Txt>
      </View>

      {/* Dismiss */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إخفاء"
        hitSlop={10}
        onPress={(e) => {
          e.stopPropagation();
          setDismissed(true);
        }}
        style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
      >
        <Feather name="x" size={17} color={colors.textGhost} />
      </Pressable>
    </Pressable>
  );
}
