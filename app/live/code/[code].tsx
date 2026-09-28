/**
 * Share-link entry «/live/code/ABC234» (PLAN_LIVE_V23 §7.3, §9.3): resolves the
 * share code to its session and replaces itself with the room, which runs the
 * identity / gender / join flow. An unknown, cancelled or gender-restricted
 * code shows a calm notice instead (get_live_by_code never reveals a
 * restricted session's title).
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { liveRoomHref } from '@/components/live/liveUi';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useLiveByCode } from '@/hooks/useLive';

export default function LiveCodeScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useLiveByCode(code);

  useEffect(() => {
    if (data?.id) router.replace(liveRoomHref(data.id));
  }, [data?.id, router]);

  const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (isLoading || data?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgSand, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator size="large" color={colors.primaryTeal} />
        <Txt size={13} color={colors.textMuted}>
          جارٍ فتح المجلس…
        </Txt>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bgSand,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 10,
      }}
    >
      <Feather name={isError ? 'wifi-off' : 'link-2'} size={26} color={colors.accentBrassMuted} />
      <Txt weight="display" size={20} align="center" style={{ alignSelf: 'stretch' }}>
        {isError ? 'تعذّر فتح الرابط' : 'لم نجد هذا المجلس'}
      </Txt>
      <Txt size={13} color={colors.textMuted} align="center" style={{ lineHeight: 22, alignSelf: 'stretch' }}>
        {isError ? 'تحقّق من اتصالك ثم أعد المحاولة.' : 'ربما انتهى، أو أن الرابط غير صحيح.'}
      </Txt>
      <Pressable
        onPress={isError ? () => void refetch() : goHome}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: 12,
          height: 44,
          paddingHorizontal: 26,
          borderRadius: radius.pill,
          backgroundColor: colors.primaryTeal,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
          {isError ? 'إعادة المحاولة' : 'العودة'}
        </Txt>
      </Pressable>
    </View>
  );
}
