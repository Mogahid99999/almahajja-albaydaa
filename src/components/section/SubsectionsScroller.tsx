/**
 * SubsectionsScroller — 2-column wrap grid of sub-section cards.
 *
 * Renders ONLY when subsections.length > 0.
 *
 * Each card is two lines:
 *   - Amiri section name on top
 *   - Topic icon (20px, teal, no tile/box) + lecture count below it
 *
 * Tap → push router to /section/[id] for that child.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { arLectureCount } from '@/lib/format';
import { colors, fonts, radius } from '@/constants/theme';
import { usePrefetchSection } from '@/hooks/useSections';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import type { SectionCard } from '@/api/types';

type Props = {
  subsections: SectionCard[];
};

export function SubsectionsScroller({ subsections }: Props) {
  const router = useRouter();

  // Warm every child section that's rendered in the scroller, so drilling in is
  // instant (V10 Perf C). prefetch is a no-op while a page is still fresh.
  const prefetch = usePrefetchSection();
  useEffect(() => {
    for (const sub of subsections) prefetch(sub.id);
  }, [prefetch, subsections]);

  if (subsections.length === 0) return null;

  return (
    <View style={{ marginTop: 24 }}>
      {/* Section heading */}
      <View style={{ paddingHorizontal: 0, marginBottom: 0 }}>
        <SectionTitle title="الأقسام الفرعية" />
      </View>

      {/* Vertical 2-column wrap grid */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {subsections.map((sub) => (
          <Pressable
            key={sub.id}
            accessibilityRole="button"
            accessibilityLabel={sub.title}
            onPress={() =>
              router.push({ pathname: '/section/[id]', params: { id: sub.id } })
            }
            style={({ pressed }) => ({
              opacity: pressed ? 0.75 : 1,
              width: '47.5%' as const,
              backgroundColor: colors.surfaceCard,
              borderColor: colors.borderSand,
              borderWidth: 1,
              borderRadius: radius.card,
              padding: 15,
            })}
          >
            {/* Section name — first line */}
            <Txt
              weight="display"
              size={16}
              color={colors.textInk}
              style={{ lineHeight: 21 }}
              numberOfLines={2}
            >
              {sub.title}
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
                <SectionIcon title={sub.title} size={20} color={colors.primaryTeal} />
              </View>

              <Txt size={11} color={colors.textGhost} tabular>
                {arLectureCount(sub.lectureCount)}
              </Txt>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
