/**
 * Profile — الحساب
 *
 * A minimal account page: user avatar (Logo + email initial), email, role label.
 * Link rows to Downloads and About. Sign-out row at the bottom.
 * No streaks/badges/journey — those are explicitly deferred (CLAUDE.md § Out of scope).
 *
 * Route: /(student)/profile
 * Design tokens: manuscript-warm palette, RTL, calm tone.
 */
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, Link } from 'expo-router';

import { useCurrentUser, useSignOut } from '@/hooks/useAuth';
import { colors, radius, shadows } from '@/constants/theme';

import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Logo } from '@/components/ui/Logo';
import { Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { PrefsToggles } from '@/components/notifications/PrefsToggles';
import { PlaybackSettings } from '@/components/settings/PlaybackSettings';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** First character of the email address (before @) for the avatar fallback. */
function avatarInitial(email: string): string {
  return email.charAt(0).toUpperCase();
}

// ── Link row ─────────────────────────────────────────────────────────────────

type LinkRowProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

function LinkRow({ icon, label, onPress, destructive = false }: LinkRowProps) {
  const tint = destructive ? colors.stateDanger : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        opacity: pressed ? 0.7 : 1,
        gap: 12,
      })}
    >
      {/* Icon on the right (RTL: first child appears rightmost) */}
      <Feather name={icon} size={18} color={tint} />

      {/* Label stretches to fill centre */}
      <Txt size={14} weight="medium" color={destructive ? colors.stateDanger : colors.textInk} style={{ flex: 1 }}>
        {label}
      </Txt>

      {/* Chevron-left on the left (RTL navigation indicator) */}
      {!destructive ? (
        <Feather name="chevron-left" size={16} color={colors.textGhost} />
      ) : null}
    </Pressable>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();

  const email = user?.email ?? '';
  const roleLabel = user?.role === 'admin' ? 'مدير' : 'طالب علم';

  return (
    <Screen bottomPad={118} padded>
      {/* ── Nav row ────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          الحساب
        </Txt>
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {/* ── User identity card ───────────────────────────────────────────────── */}
      <Card style={[{ marginBottom: 16 }, shadows.feature]}>
        <View style={{ alignItems: 'center', gap: 12 }}>
          {/* Avatar: Logo circle with the email initial overlaid */}
          <View style={{ position: 'relative' }}>
            {/* Outer brass-ring teal circle (same as Logo but larger) */}
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                borderWidth: 2,
                borderColor: colors.accentBrass,
                backgroundColor: colors.primaryTeal,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {email ? (
                <Txt size={26} weight="display" color={colors.onTealPrimary} align="center">
                  {avatarInitial(email)}
                </Txt>
              ) : (
                /* Fallback to rhombus when no email yet */
                <Rhombus size={22} color={colors.accentBrass} />
              )}
            </View>
          </View>

          {/* Email */}
          {email ? (
            <Txt size={13} color={colors.textMuted} align="center" numberOfLines={1}>
              {email}
            </Txt>
          ) : null}

          {/* Role pill */}
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 4,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(31,74,66,0.09)',
              borderWidth: 1,
              borderColor: 'rgba(31,74,66,0.15)',
            }}
          >
            <Txt size={12} weight="semibold" color={colors.primaryTeal} align="center">
              {roleLabel}
            </Txt>
          </View>
        </View>
      </Card>

      {/* ── Links card ───────────────────────────────────────────────────────── */}
      <Card padded={false} style={{ overflow: 'hidden', marginBottom: 16 }}>
        <LinkRow
          icon="compass"
          label="رحلتي العلمية"
          onPress={() => router.push('/(student)/journey')}
        />
        <Divider />
        <LinkRow
          icon="download"
          label="المحاضرات المحمّلة"
          onPress={() => router.push('/(student)/downloads')}
        />
        <Divider />
        <LinkRow
          icon="info"
          label="عن المنصة"
          onPress={() => router.push('/(student)/about')}
        />
      </Card>

      {/* ── Playback settings (auto-advance) ─────────────────────────────────── */}
      <View style={{ marginBottom: 16 }}>
        <PlaybackSettings />
      </View>

      {/* ── Notification preferences (feature B) ─────────────────────────────── */}
      <View style={{ marginBottom: 16 }}>
        <PrefsToggles />
      </View>

      {/* ── Sign-out card ────────────────────────────────────────────────────── */}
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <LinkRow
          icon="log-out"
          label="تسجيل الخروج"
          onPress={() => signOut.mutate()}
          destructive
        />
      </Card>
    </Screen>
  );
}
