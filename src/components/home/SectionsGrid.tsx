import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, useWindowDimensions, View } from 'react-native';

import type { SectionCard } from '@/api/types';
import { colors, radius, spacing } from '@/constants/theme';
import { arLectureCount } from '@/lib/format';
import { usePrefetchSection } from '@/hooks/useSections';
import { Card, SectionIcon, SectionTitle, Txt } from '@/components/ui';

type Props = {
  sections: SectionCard[];
};

/**
 * "الأقسام العِلمية" — 2-column grid of section cards.
 * Each card is two lines: the section title on top, then a smaller topic
 * icon with the Arabic lecture count below it.
 * Tapping navigates to `/section/[id]`.
 */
export function SectionsGrid({ sections }: Props) {
  const router = useRouter();
  const { width } = useWindowDimensions();

  if (sections.length === 0) return null;

  // Exact 2-column width on the 12px grid: screen padding on both sides
  // (spacing.screenH each) plus one 12px gap between the two columns.
  const contentWidth = width - spacing.screenH * 2;
  const cardWidth = (contentWidth - spacing.screenH) / 2;

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle title="الأقسام العلمية" />

      {/* 2-column wrap layout using flex */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.screenH,
        }}
      >
        {sections.map((section) => (
          <SectionGridCard
            key={section.id}
            section={section}
            width={cardWidth}
            onPress={() =>
              router.push({ pathname: '/section/[id]', params: { id: section.id } })
            }
          />
        ))}
      </View>
    </View>
  );
}

function SectionGridCard({
  section,
  width,
  onPress,
}: {
  section: SectionCard;
  width: number;
  onPress: () => void;
}) {
  // Warm this section's page while it's on screen, so the tap opens instantly.
  const prefetch = usePrefetchSection();
  useEffect(() => {
    prefetch(section.id);
  }, [prefetch, section.id]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={section.title}
      style={({ pressed }) => ({
        width,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Card
        padded={false}
        style={{
          padding: 15,
        }}
      >
        {/* Section title — first line */}
        <Txt
          weight="semibold"
          size={14}
          color={colors.textInk}
          style={{ lineHeight: 19 }}
          numberOfLines={2}
        >
          {section.title}
        </Txt>

        {/* Icon + lecture count — second line */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
          }}
        >
          <View
            style={{
              width: 30,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SectionIcon title={section.title} size={20} color={colors.primaryTeal} />
          </View>

          <Txt size={11} color={colors.textGhost}>
            {arLectureCount(section.lectureCount)}
          </Txt>
        </View>
      </Card>
    </Pressable>
  );
}
