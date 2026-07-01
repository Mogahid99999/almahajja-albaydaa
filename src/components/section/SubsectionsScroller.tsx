/**
 * SubsectionsScroller — horizontal RTL snap-scroller for sub-sections.
 *
 * Renders ONLY when subsections.length > 0.
 *
 * Each card (152px wide):
 *   - Letter tile (38px, teal letter on eef0e9 background) + chevron-left (→ left = forward in RTL)
 *   - Amiri section name
 *   - Lecture count in Arabic-Indic
 *
 * Tap → push router to /section/[id] for that child.
 *
 * Design ref: screens/صفحة القسم.dc.html › sub-sections block.
 * RTL note: the forward chevron on each card points LEFT (`chevron-left`)
 * because navigating deeper in RTL means going visually leftward.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { arLectureCount } from '@/lib/format';
import { colors, fonts, radius } from '@/constants/theme';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import type { SectionCard } from '@/api/types';

type Props = {
  subsections: SectionCard[];
};

export function SubsectionsScroller({ subsections }: Props) {
  const router = useRouter();

  if (subsections.length === 0) return null;

  return (
    <View style={{ marginTop: 24 }}>
      {/* Section heading */}
      <View style={{ paddingHorizontal: 0, marginBottom: 0 }}>
        <SectionTitle title="الأقسام الفرعية" />
      </View>

      {/* Horizontal RTL scroll */}
      <ScrollView
        horizontal
        // RTL scroll starts from the right
        style={{ direction: 'rtl' } as any}
        contentContainerStyle={{
          gap: 12,
          paddingBottom: 4,
        }}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={152 + 12} // card width + gap
        snapToAlignment="start"
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
              width: 152,
              flexShrink: 0,
              backgroundColor: colors.surfaceCard,
              borderColor: colors.borderSand,
              borderWidth: 1,
              borderRadius: radius.card,
              padding: 15,
            })}
          >
            {/* Top row: letter tile + forward chevron */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {/* Letter emblem tile */}
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  backgroundColor: '#eef0e9',
                  borderWidth: 1,
                  borderColor: '#d8e0d4',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt
                  weight="display"
                  size={19}
                  color={colors.primaryTeal}
                  align="center"
                  centerGlyph
                >
                  {sub.coverLetter}
                </Txt>
              </View>

              {/* chevron-left = forward in RTL */}
              <Feather
                name="chevron-left"
                size={16}
                color={colors.accentBrassSoft}
              />
            </View>

            {/* Section name */}
            <Txt
              weight="display"
              size={16}
              color={colors.textInk}
              style={{ marginTop: 12, lineHeight: 21 }}
              numberOfLines={2}
            >
              {sub.title}
            </Txt>

            {/* Lecture count */}
            <Txt
              size={11}
              color={colors.textGhost}
              style={{ marginTop: 4 }}
              tabular
            >
              {arLectureCount(sub.lectureCount)}
            </Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
