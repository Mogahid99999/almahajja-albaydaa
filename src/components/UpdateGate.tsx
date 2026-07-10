/**
 * Binary-update gate (Issue 5 + Item 9). On native, checks the installed app
 * version against two INDEPENDENT remote signals from `app_config`:
 *
 *  1. `min_app_version` (migration 0021) — a manual admin-flipped emergency
 *     override. Below it → hard block immediately, no matter how recently it
 *     was set. Unchanged from Issue 5.
 *  2. `latest_app_version` + `latest_released_at` (migration 0055) — an
 *     automatic 30-day grace period (Item 9). Once an admin records a new
 *     build's version + release date, installs behind it get a small
 *     dismissible nudge for 30 days, then a hard block — whichever of (1) or
 *     (2) demands an update first wins.
 *
 * Either hard-block condition renders the calm blocking "حدّث التطبيق" screen
 * instead of the app; the soft nudge renders a small dismissible banner ABOVE
 * the normal app content (not replacing it). Fail-open throughout: while the
 * check is loading or if it errors, children render — the gate never keeps
 * the app from opening on a network hiccup. Web (admin dashboard) is exempt
 * from both mechanisms.
 */
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAppVersionGate } from '@/api/appVersion';
import { Logo } from '@/components/ui/Logo';
import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { compareVersions } from '@/lib/version';

const installedVersion = Constants.expoConfig?.version ?? '0.0.0';
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

export function UpdateGate({ children }: { children: ReactNode }) {
  const enabled = Platform.OS !== 'web';
  const { data } = useQuery({
    queryKey: ['appVersionGate'],
    queryFn: getAppVersionGate,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // (1) Manual emergency override — unchanged condition from Issue 5.
  const isBelowMin =
    enabled && !!data?.minVersion && compareVersions(installedVersion, data.minVersion) < 0;

  // (2) Automatic 30-day grace period (Item 9) — independent of (1). Empty or
  // missing latestVersion/latestReleasedAt simply never trigger this.
  const isBelowLatest =
    enabled && !!data?.latestVersion && compareVersions(installedVersion, data.latestVersion) < 0;
  const releaseAgeMs = data?.latestReleasedAt
    ? Date.now() - new Date(data.latestReleasedAt).getTime()
    : NaN;
  const graceExpired =
    isBelowLatest && Number.isFinite(releaseAgeMs) && releaseAgeMs > THIRTY_DAYS_MS;

  const needsUpdate = isBelowMin || graceExpired;
  const url = data?.downloadUrl;

  if (needsUpdate) {
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

  // Soft nudge: behind the latest published build, but the 30-day grace
  // period hasn't elapsed yet — a small dismissible notice ABOVE the app,
  // never blocking it. Dismiss is session-only (plain state), per spec.
  const showNudge = isBelowLatest && !graceExpired && !nudgeDismissed;
  if (!showNudge) return <>{children}</>;

  return (
    <View style={{ flex: 1 }}>
      <UpdateNudgeBanner url={url} onDismiss={() => setNudgeDismissed(true)} />
      {children}
    </View>
  );
}

function UpdateNudgeBanner({
  url,
  onDismiss,
}: {
  url: string | null | undefined;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, backgroundColor: colors.bgSand }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: radius.card,
          backgroundColor: 'rgba(201,164,99,0.14)',
          borderWidth: 1,
          borderColor: 'rgba(201,164,99,0.3)',
        }}
      >
        <Feather name="download" size={16} color={colors.accentBrassMuted} />
        <Txt size={12.5} color={colors.textInk} style={{ flex: 1 }}>
          يتوفر إصدار جديد، يفضّل التحديث قريبًا
        </Txt>
        {url ? (
          <Pressable
            onPress={() => void Linking.openURL(url)}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Txt size={12.5} weight="semibold" color={colors.primaryTeal}>
              تحديث
            </Txt>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إخفاء"
          hitSlop={10}
          onPress={onDismiss}
          style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
        >
          <Feather name="x" size={16} color={colors.textGhost} />
        </Pressable>
      </View>
    </View>
  );
}
