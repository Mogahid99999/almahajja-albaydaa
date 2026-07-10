import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { LectureCard } from '@/api/types';
import { colors, radius, spacing } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { preloadLecture } from '@/lib/audioController';
import { SectionTitle, Txt } from '@/components/ui';
import { SectionIcon } from '@/components/ui/SectionIcon';

/** Diameter of the subject-icon badge straddling the card's top-right corner. */
const BADGE_SIZE = 34;

/** Single cover tint used for all cards — matches the navbar's active gold accent. */
const COVER_TINTS = [{ from: '#786422', to: '#786422' }];

/** Cover tile aspect ratio — 4:3 (height = width × 0.75), a quarter shorter than a square. */
const TILE_ASPECT = 0.75;

type Props = {
  lectures: LectureCard[];
};

/**
 * "أُضيف حديثاً" — horizontally scrolling rail of the newest published lectures
 * (auto-sorted by created_at). Card width is computed so exactly 2 land flush
 * with 12px on both screen edges and 12px between them; further cards scroll
 * in from off-screen. Tapping a card opens the player.
 * Renders nothing when the list is empty.
 */
export function NewlyAddedRail({ lectures }: Props) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  if (lectures.length === 0) return null;

  // 2 cards flush with both edges: edge + card + gap + card + edge, all 12px.
  const cardWidth = (width - spacing.screenH * 3) / 2;
  const tileHeight = cardWidth * TILE_ASPECT;

  return (
    <View style={{ marginTop: 28 }}>
      <View style={{ paddingHorizontal: spacing.screenH }}>
        <SectionTitle
          title="أُضيف حديثاً"
          actionLabel="عرض الكل"
          onAction={() => router.push('/(student)/recent')}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: spacing.screenH,
          paddingHorizontal: spacing.screenH,
          paddingBottom: 4,
        }}
      >
        {lectures.map((lecture, idx) => {
          const tint = COVER_TINTS[idx % COVER_TINTS.length]!;
          return (
            <NewlyAddedCard
              key={lecture.id}
              lecture={lecture}
              tint={tint}
              width={cardWidth}
              height={tileHeight}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function NewlyAddedCard({
  lecture,
  tint,
  width,
  height,
}: {
  lecture: LectureCard;
  tint: { from: string; to: string };
  width: number;
  height: number;
}) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        // Start playback the instant the tap lands, in parallel with the
        // navigation — see preloadLecture's doc comment in audioController.
        void preloadLecture(lecture.id);
        router.push(`/player/${lecture.id}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={`تشغيل: ${lecture.title}`}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.85 : 1 })}
    >
      {/* Cover tile */}
      <View
        style={{
          width,
          height,
          borderRadius: radius.card,
          backgroundColor: tint.to,
          borderWidth: 1,
          borderColor: colors.borderSand2,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Gradient overlay approximated with two layered views */}
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: tint.from,
            opacity: 0.85,
          } as object}
        />

        {/* Decorative circle motif */}
        <View
          style={{
            position: 'absolute',
            right: -22,
            bottom: -22,
            width: 90,
            height: 90,
            borderRadius: 45,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.18)',
          }}
        />

        {/* Play button glyph */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            borderWidth: 1.5,
            borderColor: 'rgba(255,255,255,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <View
            style={{
              width: 0,
              height: 0,
              borderTopWidth: 6,
              borderBottomWidth: 6,
              borderRightWidth: 9,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              borderRightColor: 'rgba(255,255,255,0.9)',
              marginLeft: -2,
            }}
          />
        </View>

        {/* Duration chip — left side (RTL: end) */}
        <View
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            backgroundColor: 'rgba(0,0,0,0.18)',
            borderRadius: 20,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          <Txt size={13} color="rgba(255,255,255,0.85)" tabular>
            {arDuration(lecture.durationSec)}
          </Txt>
        </View>
      </View>

      {/* Subject icon — top-right corner, fully inside the card, no badge background */}
      <View
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SectionIcon title={lecture.sectionTitle ?? ''} size={18} color="rgb(241, 233, 217)" />
      </View>

      {/* Title */}
      <Txt
        weight="display"
        size={15}
        color={colors.textInk}
        style={{ marginTop: 10, lineHeight: 15 * 1.5 }}
        numberOfLines={2}
      >
        {lecture.title}
      </Txt>

      {/* Sheikh */}
      {lecture.sheikhName ? (
        <Txt size={11} color={colors.textGhost} style={{ marginTop: 3 }}>
          {lecture.sheikhName}
        </Txt>
      ) : null}
    </Pressable>
  );
}
