/**
 * About — عن المنصة
 *
 * A prominent, calm page introducing the platform and inviting du'a for the
 * scholars and contributors. Copy is now editable from the admin panel
 * (app_config, Feature 6) and falls back to the original text; a Telegram
 * live-broadcast button appears only when an admin has set the channel URL.
 *
 * Route: /(student)/about
 */
import { Linking, Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import { colors, radius, shadows } from '@/constants/theme';

import { appVersionLabel } from '@/lib/version';
import { ABOUT_FALLBACK } from '@/api/appContent';
import { useAboutContent } from '@/hooks/useAppContent';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { ConcentricMotif } from '@/components/ui/Rhombus';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Logo } from '@/components/ui/Logo';
import { Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';

export default function AboutScreen() {
  const router = useRouter();
  const { data } = useAboutContent();
  const content = data ?? ABOUT_FALLBACK;
  const miniPad = useMiniPlayerPad();

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      {/* ── Nav row ── back button on the RIGHT (RTL): flex-start = right edge ── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
          marginBottom: 28,
        }}
      >
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {/* ── Hero: Logo + title ───────────────────────────────────────────────── */}
      <View style={{ alignItems: 'center', gap: 14, marginBottom: 32 }}>
        <Logo size={56} />
        <Txt size={26} weight="display" color={colors.primaryTeal} align="center">
          عن المنصة
        </Txt>
        <Rhombus size={8} color={colors.accentBrassMuted} />
      </View>

      {/* ── Body card ────────────────────────────────────────────────────────── */}
      <Card style={[{ gap: 0, overflow: 'hidden' }, shadows.feature]}>
        <ConcentricMotif
          size={180}
          rings={3}
          color="rgba(31,74,66,0.045)"
          style={{ top: -40, left: -40 }}
        />

        <Txt
          size={14}
          color={colors.textMuted}
          style={{ lineHeight: 24, marginBottom: 20 }}
          align="right"
        >
          {content.intro}
        </Txt>

        <Divider />

        <Txt
          size={14}
          weight="displayRegular"
          color={colors.primaryTeal}
          style={{ lineHeight: 26, marginTop: 20, marginBottom: 20 }}
          align="right"
        >
          {content.dua}
        </Txt>

        <Divider />

        <Txt
          size={14}
          weight="displayRegular"
          color={colors.primaryTeal}
          style={{ lineHeight: 26, marginTop: 20, marginBottom: 20 }}
          align="right"
        >
          {content.thanks}
        </Txt>

        <Divider />

        <Txt
          size={14}
          color={colors.textMuted}
          style={{ lineHeight: 24, marginTop: 20 }}
          align="right"
        >
          {content.closing}
        </Txt>
      </Card>

      {/* ── التعريف بالشيخ (Item 8) ──────────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/(student)/sheikh-info')}
        accessibilityRole="button"
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            height: 52,
            paddingHorizontal: 16,
            borderRadius: radius.input,
            backgroundColor: colors.surfaceWhite,
            borderWidth: 1,
            borderColor: colors.borderSand2,
            marginTop: 20,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Feather name="user" size={16} color={colors.primaryTeal} />
        <Txt size={14} weight="medium" color={colors.textInk} style={{ flex: 1 }}>
          التعريف بالشيخ
        </Txt>
        <Feather name="chevron-left" size={16} color={colors.textGhost} />
      </Pressable>

      {/* ── Telegram live broadcast (only when a channel URL is set) ─────────── */}
      {content.telegramUrl ? (
        <Card style={{ marginTop: 20, gap: 16 }}>
          <Txt size={14} color={colors.textMuted} style={{ lineHeight: 24 }} align="right">
            {content.telegramIntro}
          </Txt>
          <Pressable
            onPress={() => Linking.openURL(content.telegramUrl)}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                height: 48,
                borderRadius: radius.input,
                backgroundColor: colors.primaryTeal,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Feather name="send" size={16} color={colors.onTealPrimary} />
            <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
              {content.telegramLabel || 'فتح قناة تلجرام'}
            </Txt>
          </Pressable>
        </Card>
      ) : null}

      {/* ── Bottom motif accent ──────────────────────────────────────────────── */}
      <View style={{ alignItems: 'center', marginTop: 32, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Rhombus size={5} color={colors.accentBrassSoft} />
          <Rhombus size={8} color={colors.accentBrassMuted} filled={false} />
          <Rhombus size={5} color={colors.accentBrassSoft} />
        </View>

        {/* Muted version footer — single-sourced from app.json (Feature B). */}
        <Txt size={11.5} color={colors.textGhost} align="center" style={{ marginTop: 8 }} tabular>
          {appVersionLabel()}
        </Txt>
      </View>
    </Screen>
  );
}
