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
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { colors, radius, shadows } from '@/constants/theme';

import { ABOUT_FALLBACK } from '@/api/appContent';
import { useAboutContent } from '@/hooks/useAppContent';
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

  return (
    <Screen bottomPad={118} padded>
      {/* ── Nav row ──────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
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
                flexDirection: 'row-reverse',
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
      </View>
    </Screen>
  );
}
