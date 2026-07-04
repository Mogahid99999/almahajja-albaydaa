/**
 * Binary-update gate (Issue 5). On native, checks the installed app version
 * against the remote `min_app_version` (app_config, migration 0021). If the
 * install is below the minimum it renders a calm blocking "حدّث التطبيق" screen
 * with a download link instead of the app; otherwise it renders its children.
 *
 * Fail-open: while the check is loading or if it errors, children render — the
 * gate never keeps the app from opening on a network hiccup. Seeded so the gate
 * is INACTIVE now (min == the current version); an admin bumps `min_app_version`
 * to force an update once a newer APK is hosted. Web (admin dashboard) is exempt.
 */
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { type ReactNode } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';

import { getAppVersionGate } from '@/api/appVersion';
import { Logo } from '@/components/ui/Logo';
import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { compareVersions } from '@/lib/version';

const installedVersion = Constants.expoConfig?.version ?? '0.0.0';

export function UpdateGate({ children }: { children: ReactNode }) {
  const enabled = Platform.OS !== 'web';
  const { data } = useQuery({
    queryKey: ['appVersionGate'],
    queryFn: getAppVersionGate,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const needsUpdate =
    enabled && !!data?.minVersion && compareVersions(installedVersion, data.minVersion) < 0;

  if (!needsUpdate) return <>{children}</>;

  const url = data?.downloadUrl;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bgSand,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 22,
      }}
    >
      <Logo size={84} />
      <Txt weight="display" size={22} color={colors.primaryTeal} align="center">
        يتوفر إصدار جديد
      </Txt>
      <Txt size={14} color={colors.textMuted} align="center" style={{ lineHeight: 24 }}>
        لمواصلة استخدام التطبيق، يرجى تحديثه إلى أحدث إصدار.
      </Txt>
      {url ? (
        <Pressable
          onPress={() => void Linking.openURL(url)}
          accessibilityRole="button"
          style={({ pressed }) => [
            {
              backgroundColor: colors.primaryTeal,
              paddingHorizontal: 28,
              paddingVertical: 14,
              borderRadius: radius.input,
              opacity: pressed ? 0.85 : 1,
            },
            shadows.button,
          ]}
        >
          <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
            تحديث التطبيق
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
