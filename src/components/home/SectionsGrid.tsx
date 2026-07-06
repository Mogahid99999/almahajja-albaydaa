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
 * Each card shows a topic icon (matched to the section title, no tile/box),
 * the section title, and an Arabic lecture count.
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
          padding: 16,
          paddingBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {/* Topic icon — no surrounding tile */}
        <View
          style={{
            width: 42,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <SectionIcon title={section.title} size={28} color={colors.primaryTeal} />
        </View>

        {/* Text */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt
            weight="semibold"
            size={14}
            color={colors.textInk}
            numberOfLines={1}
          >
            {section.title}
          </Txt>
          <Txt
            size={11}
            color={colors.textGhost}
            style={{ marginTop: 2 }}
            numberOfLines={1}
          >
            {arLectureCount(section.lectureCount)}
          </Txt>
        </View>
      </Card>
    </Pressable>
  );
}
