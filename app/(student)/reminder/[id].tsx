/**
 * تذكير نافع — beneficial-reminder detail page (V7).
 *
 * Opened from the notification shade, the in-app inbox row, or the Home card.
 * A calm reading page in the About-page style: brass eyebrow, display title,
 * and the full reminder body over a quiet concentric motif.
 *
 * Route: /(student)/reminder/[id]
 */
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors, shadows } from '@/constants/theme';
import { useBroadcast } from '@/hooks/useBroadcasts';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { arNum } from '@/lib/format';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { ConcentricMotif, Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';

/** Calm relative time, mirroring the inbox wording. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${arNum(mins)} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${arNum(hours)} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${arNum(days)} يوم`;
}

export default function ReminderDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useBroadcast(id ?? '');
  const miniPad = useMiniPlayerPad();

  return (
    <Screen bottomPad={miniPad || 24} padded>
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
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityLabel="رجوع"
        />
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : !data ? (
        <View style={{ paddingVertical: 72, alignItems: 'center', gap: 10 }}>
          <Rhombus size={40} color={colors.borderSand2} />
          <Txt size={14} weight="semibold" color={colors.textMuted} align="center">
            هذا التذكير لم يعد متاحاً
          </Txt>
        </View>
      ) : (
        <>
          {/* ── Hero: eyebrow + title ─────────────────────────────────────────── */}
          <View style={{ alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Rhombus size={7} color={colors.accentBrass} filled />
              <Txt size={12.5} weight="semibold" color={colors.accentBrass}>
                تذكير نافع
              </Txt>
              <Rhombus size={7} color={colors.accentBrass} filled />
            </View>
            <Txt size={24} weight="display" color={colors.primaryTeal} align="center">
              {data.title}
            </Txt>
            <Txt size={11.5} color={colors.textGhost}>
              {relativeTime(data.publishedAt)}
            </Txt>
          </View>

          {/* ── Body card ─────────────────────────────────────────────────────── */}
          <Card style={[{ overflow: 'hidden' }, shadows.feature]}>
            <ConcentricMotif
              size={180}
              rings={3}
              color="rgba(31,74,66,0.045)"
              style={{ top: -40, left: -40 }}
            />
            <Txt
              size={15}
              weight="displayRegular"
              color={colors.textInk}
              style={{ lineHeight: 28 }}
              align="right"
            >
              {data.body}
            </Txt>
          </Card>

          {/* ── Bottom motif accent ───────────────────────────────────────────── */}
          <View style={{ alignItems: 'center', marginTop: 32 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Rhombus size={5} color={colors.accentBrassSoft} />
              <Rhombus size={8} color={colors.accentBrassMuted} filled={false} />
              <Rhombus size={5} color={colors.accentBrassSoft} />
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}
