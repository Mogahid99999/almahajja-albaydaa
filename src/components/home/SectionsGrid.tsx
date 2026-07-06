import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { SectionCard } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { arLectureCount } from '@/lib/format';
import { usePrefetchSection } from '@/hooks/useSections';
import { Card, SectionIcon, SectionTitle, Txt } from '@/components/ui';

type Props = {
  sections: SectionCard[];
};

/**
 * "الأقسام العِلمية" — 2-column grid of section cards.
 * Each card stacks a topic icon, then the section title, then an Arabic
 * lecture count — each on its own line, matching the sub-sections cards.
 * Tapping navigates to `/section/[id]`.
 */
export function SectionsGrid({ sections }: Props) {
  const router = useRouter();

  if (sections.length === 0) return null;

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle title="الأقسام العلمية" />

      {/* 2-column wrap layout using flex */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {sections.map((section) => (
          <SectionGridCard
            key={section.id}
            section={section}
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
  onPress,
}: {
  section: SectionCard;
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
        // Each card takes half width minus half the gap (6px per side)
        width: '47.5%' as const,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Card
        padded={false}
        style={{
          padding: 15,
        }}
      >
        {/* Topic icon — no surrounding tile */}
        <View
          style={{
            width: 38,
            height: 38,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SectionIcon title={section.title} size={25} color={colors.primaryTeal} />
        </View>

        {/* Section title — own line, room to wrap */}
        <Txt
          weight="semibold"
          size={14}
          color={colors.textInk}
          style={{ marginTop: 12, lineHeight: 19 }}
          numberOfLines={2}
        >
          {section.title}
        </Txt>

        {/* Lecture count */}
        <Txt
          size={11}
          color={colors.textGhost}
          style={{ marginTop: 4 }}
        >
          {arLectureCount(section.lectureCount)}
        </Txt>
      </Card>
    </Pressable>
  );
}
