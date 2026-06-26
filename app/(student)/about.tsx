/**
 * About — عن المنصة
 *
 * A prominent, calm page introducing the platform and inviting du'a for the
 * scholars and contributors. No imagery — geometric motif (ConcentricMotif,
 * Rhombus) as the visual language. Du'a lines highlighted in primaryTeal.
 *
 * Route: /(student)/about
 * Design ref: CLAUDE.md § About, README design tokens.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors, radius, shadows } from '@/constants/theme';

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
        {/* Small decorative rhombus under the title */}
        <Rhombus size={8} color={colors.accentBrassMuted} />
      </View>

      {/* ── Body card ────────────────────────────────────────────────────────── */}
      <Card
        style={[
          {
            gap: 0,
            overflow: 'hidden',
          },
          shadows.feature,
        ]}
      >
        {/* Decorative concentric motif — absolutely positioned behind text */}
        <ConcentricMotif
          size={180}
          rings={3}
          color="rgba(31,74,66,0.045)"
          style={{ top: -40, left: -40 }}
        />

        {/* Paragraph 1: platform purpose */}
        <Txt
          size={14}
          color={colors.textMuted}
          style={{ lineHeight: 24, marginBottom: 20 }}
          align="right"
        >
          «هذه المنصة تهدف إلى تنظيم دروس العلم الشرعي وتيسير الوصول إليها، وجمع التسجيلات المتفرقة في مكان واحد مرتب يعين الطالب على المتابعة والمراجعة.»
        </Txt>

        <Divider />

        {/* Paragraph 2: du'a for sincerity — emphasised in teal */}
        <Txt
          size={14}
          weight="displayRegular"
          color={colors.primaryTeal}
          style={{ lineHeight: 26, marginTop: 20, marginBottom: 20 }}
          align="right"
        >
          «نسأل الله أن يجعل هذا العمل خالصًا لوجهه الكريم، وأن ينفع به طلاب العلم.»
        </Txt>

        <Divider />

        {/* Paragraph 3: du'a for contributors — emphasised in teal */}
        <Txt
          size={14}
          weight="displayRegular"
          color={colors.primaryTeal}
          style={{ lineHeight: 26, marginTop: 20, marginBottom: 20 }}
          align="right"
        >
          «لا تنسوا من ساهم في هذا العمل من دعائكم: المشايخ، ومن جمع المادة، ومن راجعها، ومن طوّر المنصة، ومن نشرها وساهم فيها.»
        </Txt>

        <Divider />

        {/* Paragraph 4: closing blessing */}
        <Txt
          size={14}
          color={colors.textMuted}
          style={{ lineHeight: 24, marginTop: 20 }}
          align="right"
        >
          «نفع الله بكم، وبارك في علمكم ووقتكم.»
        </Txt>
      </Card>

      {/* ── Bottom motif accent ──────────────────────────────────────────────── */}
      <View
        style={{
          alignItems: 'center',
          marginTop: 32,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Rhombus size={5} color={colors.accentBrassSoft} />
          <Rhombus size={8} color={colors.accentBrassMuted} filled={false} />
          <Rhombus size={5} color={colors.accentBrassSoft} />
        </View>
      </View>
    </Screen>
  );
}
