/**
 * تذكير نافع — beneficial-reminder detail page (V7).
 *
 * Opened from the notification shade, the in-app inbox row, or the Home card.
 * A calm reading page in the About-page style: brass eyebrow, display title,
 * and the full reminder body over a quiet concentric motif.
 *
 * Route: /(student)/reminder/[id]
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getBroadcastAudioUrl, recordBroadcastView } from '@/api/broadcasts';
import { VoiceNotePlayer } from '@/components/questions/VoiceNotePlayer';
import { colors, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBroadcast, useBroadcastImageUrl } from '@/hooks/useBroadcasts';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { arNum } from '@/lib/format';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
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
  const { data: imageUrl } = useBroadcastImageUrl(data?.imagePath ?? null);
  const { data: user } = useCurrentUser();
  const miniPad = useMiniPlayerPad();

  // Record a view once the reminder loads (fire-and-forget; never blocks render).
  // Guests are skipped here too, though the SQL guard also refuses anon sessions.
  useEffect(() => {
    if (!data?.id || user?.isGuest) return;
    void recordBroadcastView(data.id);
  }, [data?.id, user?.isGuest]);

  // Show the reminder image at its TRUE aspect ratio so a tall poster (like the
  // course flyer) is never cropped by a fixed 16:9 frame. Measure the real
  // dimensions once the URL is known; fall back to 16:9 until then.
  const [imgRatio, setImgRatio] = useState<number | null>(null);
  useEffect(() => {
    setImgRatio(null);
    if (!imageUrl) return;
    let cancelled = false;
    Image.getSize(
      imageUrl,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setImgRatio(w / h);
      },
      () => {
        /* keep the fallback ratio on failure */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  function openLink() {
    const url = data?.linkUrl;
    if (!url) return;
    if (url.startsWith('/')) {
      router.push(url as Parameters<typeof router.push>[0]);
    } else {
      void Linking.openURL(url);
    }
  }

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
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

          {/* ── Image (optional) ──────────────────────────────────────────────── */}
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={{
                width: '100%',
                // Real aspect ratio once measured (fallback 16:9) so a tall
                // poster shows in full instead of being cropped.
                aspectRatio: imgRatio ?? 16 / 9,
                borderRadius: radius.card,
                marginBottom: 16,
                backgroundColor: colors.surfaceInset,
              }}
              // `contain` guarantees the whole image is visible whatever its
              // shape; with the true aspectRatio there's no letterboxing.
              resizeMode="contain"
            />
          ) : null}

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

          {/* ── Audio clip (optional) — inline player w/ speed + seekbar ──────── */}
          {data.audioPath ? (
            <Card style={{ marginTop: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Feather name="headphones" size={13} color={colors.primaryTeal600} />
                <Txt size={11.5} weight="semibold" color={colors.primaryTeal600}>
                  مقطع صوتي
                </Txt>
              </View>
              <VoiceNotePlayer audioPath={data.audioPath} resolveUrl={getBroadcastAudioUrl} showSpeed />
            </Card>
          ) : null}

          {/* ── Action button (optional) ─────────────────────────────────────── */}
          {data.linkUrl ? (
            <Pressable
              onPress={openLink}
              style={({ pressed }) => [
                {
                  marginTop: 18,
                  height: 48,
                  borderRadius: radius.sm,
                  backgroundColor: colors.primaryTeal,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                shadows.button,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Txt weight="semibold" size={14.5} color={colors.onTealPrimary}>
                {data.linkLabel || 'اطّلع أكثر'}
              </Txt>
            </Pressable>
          ) : null}

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
