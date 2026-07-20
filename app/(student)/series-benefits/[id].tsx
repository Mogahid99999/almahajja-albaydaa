/**
 * «مراجعة الفوائد» — all shared فوائد across a whole series, grouped by the lesson
 * they belong to. Reached from the «ملخص إتمام السلسلة» closing page (V20 · A).
 *
 * Route: /(student)/series-benefits/[id]  (id = the series' root section)
 *
 * Anonymous like every فوائد surface — no author name; the student's own are
 * quietly tagged «فائدتك». Grouped under a lesson header (order + title); tapping
 * a group header opens that lesson's full فوائد board. Calm, RTL, Arabic numerals.
 */
import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import type { SeriesBenefit } from '@/api/seriesSummary';
import { colors, radius } from '@/constants/theme';
import { arNum, arSince } from '@/lib/format';
import { useSectionPage } from '@/hooks/useSections';
import { useSeriesBenefits } from '@/hooks/useSeriesCompletionSummary';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Screen, ScreenHeader, Txt } from '@/components/ui';

type LectureGroup = {
  lectureId: string;
  lectureTitle: string;
  lectureOrder: number;
  items: SeriesBenefit[];
};

/** Group the flat benefit list by lesson, preserving the RPC's lesson order. */
function groupByLecture(benefits: SeriesBenefit[]): LectureGroup[] {
  const map = new Map<string, LectureGroup>();
  for (const b of benefits) {
    let g = map.get(b.lectureId);
    if (!g) {
      g = {
        lectureId: b.lectureId,
        lectureTitle: b.lectureTitle,
        lectureOrder: b.lectureOrder,
        items: [],
      };
      map.set(b.lectureId, g);
    }
    g.items.push(b);
  }
  return Array.from(map.values());
}

function BenefitCard({ b }: { b: SeriesBenefit }) {
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(176,137,79,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="award" size={13} color={colors.accentBrassMuted} />
        </View>
        <Txt size={11.5} color={colors.textGhost} style={{ flex: 1 }}>
          {b.isMine ? 'فائدتك · دون اسم' : 'أحد الدارسين'} · {arSince(b.createdAt)}
        </Txt>
      </View>
      <Txt size={14} color={colors.textInk} style={{ lineHeight: 24 }}>
        {b.body}
      </Txt>
    </Card>
  );
}

function GroupSection({
  group,
  onOpenLecture,
}: {
  group: LectureGroup;
  onOpenLecture: () => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      {/* Lesson header — «الدرس ن · العنوان», tappable → that lesson's board. */}
      <Pressable
        onPress={onOpenLecture}
        accessibilityRole="button"
        accessibilityLabel={`فتح فوائد ${group.lectureTitle}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            paddingVertical: 3,
            paddingHorizontal: 9,
            borderRadius: radius.pill,
            backgroundColor: colors.bgSandRaised,
            borderWidth: 1,
            borderColor: colors.borderSand,
          }}
        >
          <Txt size={11} weight="semibold" color={colors.accentBrassMuted} tabular>
            {`الدرس ${arNum(group.lectureOrder)}`}
          </Txt>
        </View>
        <Txt
          size={13.5}
          weight="semibold"
          color={colors.primaryTeal}
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {group.lectureTitle}
        </Txt>
        <Feather name="chevron-left" size={16} color={colors.textGhost} />
      </Pressable>

      {group.items.map((b) => (
        <BenefitCard key={b.id} b={b} />
      ))}
    </View>
  );
}

export default function SeriesBenefitsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sectionId = id ?? '';
  const { data: page } = useSectionPage(sectionId);
  const { data: benefits, isLoading } = useSeriesBenefits(sectionId);
  const miniPad = useMiniPlayerPad();

  const groups = useMemo(() => groupByLecture(benefits ?? []), [benefits]);
  const total = benefits?.length ?? 0;

  return (
    <Screen padded bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}>
      {/* Header — back button on the RIGHT (RTL) via ScreenHeader. */}
      <ScreenHeader title="مراجعة الفوائد" style={{ marginBottom: 6 }} />
      {page?.section.title ? (
        <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 18 }} numberOfLines={1}>
          {page.section.title}
        </Txt>
      ) : (
        <View style={{ marginBottom: 18 }} />
      )}

      {isLoading && !benefits ? (
        <View style={{ paddingVertical: 50, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : total === 0 ? (
        <View style={{ paddingVertical: 50, alignItems: 'center', gap: 8 }}>
          <Feather name="award" size={24} color={colors.textGhost} />
          <Txt size={13.5} color={colors.textMuted} align="center">
            لا فوائد في هذه السلسلة بعد
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            شارك فائدة من أي درس — تُنشر دون اسمك
          </Txt>
        </View>
      ) : (
        <View style={{ gap: 24 }}>
          {groups.map((g) => (
            <GroupSection
              key={g.lectureId}
              group={g}
              onOpenLecture={() =>
                router.push({ pathname: '/lecture-benefits/[id]', params: { id: g.lectureId } })
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
