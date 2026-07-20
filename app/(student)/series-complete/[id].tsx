/**
 * «ملخص إتمام السلسلة» — the calm closing page shown once a student finishes a
 * whole series (the recursive subtree of one section). V20 · Feature A.
 *
 * Route: /(student)/series-complete/[id]  (id = the series' root section)
 *
 * Reached from: the section page's «تمّت بحمد الله» seal (عرض ملخص السلسلة), the
 * JourneyMap row seal, and — once-ever, server-deduped — the celebration modal's
 * «عرض الملخص» right after the final lesson completes.
 *
 * Quiet rows (empty rows are HIDDEN, never shown as zeros), the start/finish
 * dates, a «مراجعة الفوائد» deep-link into this series, and the closing du'ā. No
 * confetti, no heavy animation (CLAUDE.md tone). Reads through the persisted query
 * cache so it opens offline.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { isSeriesComplete } from '@/api/seriesSummary';
import { arDate, arDuration, arNum } from '@/lib/format';
import { useSectionPage } from '@/hooks/useSections';
import { useSeriesCompletionSummary } from '@/hooks/useSeriesCompletionSummary';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Screen, ScreenHeader, Txt } from '@/components/ui';
import { SeriesSeal } from '@/components/journey/SeriesSeal';

/** One quiet stat row «label … value». Rendered only when `show` is true. */
function StatRow({ label, value, show = true }: { label: string; value: string; show?: boolean }) {
  if (!show) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 11,
      }}
    >
      <Txt size={13.5} color={colors.textMuted}>
        {label}
      </Txt>
      <Txt size={14} weight="semibold" color={colors.textInk} tabular>
        {value}
      </Txt>
    </View>
  );
}

export default function SeriesCompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sectionId = id ?? '';
  const { data: page } = useSectionPage(sectionId);
  const { data: summary, isLoading } = useSeriesCompletionSummary(sectionId);
  const miniPad = useMiniPlayerPad();

  const title = page?.section.title ?? '';
  const parentTitle = page?.parentTitle ?? null;

  if (isLoading && !summary) {
    return (
      <Screen padded>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  const s = summary;
  const complete = s ? isSeriesComplete(s) : false;

  // A quiz row only when the student actually took a quiz in this series.
  const quizValue =
    s && s.quizzesTaken > 0
      ? s.quizPointsTotal > 0
        ? `${arNum(s.quizBestTotal)} من ${arNum(s.quizPointsTotal)}`
        : `${arNum(s.quizzesTaken)} اختباراً`
      : '';

  return (
    <Screen padded bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}>
      {/* Header row — back button on the RIGHT (RTL) via ScreenHeader. */}
      <ScreenHeader title="ملخص إتمام السلسلة" titleSize={20} style={{ marginBottom: 18 }} />

      {/* Seal + series title */}
      <View style={{ alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <SeriesSeal variant="block" />
        {parentTitle ? (
          <Txt size={12} weight="medium" color={colors.accentBrassMuted} align="center">
            {parentTitle}
          </Txt>
        ) : null}
        <Txt size={19} weight="display" color={colors.textInk} align="center" style={{ lineHeight: 28 }}>
          {title}
        </Txt>
      </View>

      {/* Stats — empty rows hidden */}
      {s ? (
        <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
          <StatRow
            label="الدروس المكتملة"
            value={`${arNum(s.completedLectures)} من ${arNum(s.totalLectures)}`}
          />
          <StatRow
            label="مدة الاستماع"
            value={arDuration(s.listeningSeconds)}
            show={s.listeningSeconds > 0}
          />
          <StatRow label="الاختبارات" value={quizValue} show={s.quizzesTaken > 0} />
          <StatRow
            label="الفوائد التي شاركتها"
            value={arNum(s.benefitsCount)}
            show={s.benefitsCount > 0}
          />
          <StatRow
            label="ملاحظاتك الخاصة"
            value={arNum(s.notesCount)}
            show={s.notesCount > 0}
          />
          <StatRow
            label="علامات المراجعة"
            value={arNum(s.bookmarksCount)}
            show={s.bookmarksCount > 0}
          />
        </Card>
      ) : null}

      {/* Dates */}
      {s && (s.startedAt || s.completedAt) ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: 14,
            paddingHorizontal: 4,
          }}
        >
          {s.startedAt ? (
            <View style={{ gap: 2 }}>
              <Txt size={11} color={colors.textGhost}>
                البداية
              </Txt>
              <Txt size={12.5} weight="medium" color={colors.textMuted} tabular>
                {arDate(s.startedAt)}
              </Txt>
            </View>
          ) : (
            <View />
          )}
          {s.completedAt ? (
            <View style={{ gap: 2, alignItems: 'flex-end' }}>
              <Txt size={11} color={colors.textGhost}>
                الإتمام
              </Txt>
              <Txt size={12.5} weight="medium" color={colors.textMuted} tabular>
                {arDate(s.completedAt)}
              </Txt>
            </View>
          ) : (
            <View />
          )}
        </View>
      ) : null}

      {/* مراجعة الفوائد → the series-wide فوائد review (grouped by lesson) */}
      {s && s.benefitsCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/series-benefits/[id]', params: { id: sectionId } })
          }
          style={({ pressed }) => ({ marginTop: 16, opacity: pressed ? 0.7 : 1 })}
        >
          <Card
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Txt size={13.5} weight="semibold" color={colors.accentBrassMuted}>
              مراجعة الفوائد
            </Txt>
            <Txt size={13.5} color={colors.textGhost}>
              {`${arNum(s.benefitsCount)} فائدة`}
            </Txt>
          </Card>
        </Pressable>
      ) : null}

      {/* Closing du'ā */}
      <View
        style={{
          marginTop: 24,
          padding: 20,
          borderRadius: radius.card,
          backgroundColor: colors.bgSandRaised,
          borderWidth: 1,
          borderColor: colors.borderSand,
          gap: 10,
        }}
      >
        <Txt size={15.5} weight="display" color={colors.primaryTeal} align="center" style={{ lineHeight: 28 }}>
          أتممت هذه السلسلة بحمد الله
        </Txt>
        <Txt size={13.5} color={colors.textMuted} align="center" style={{ lineHeight: 26 }}>
          نسأل الله أن ينفعك بما تعلمت ويجعله حجة لك لا عليك
        </Txt>
      </View>

      {/* If somehow opened before completion, a quiet note (no zeros shown above). */}
      {s && !complete ? (
        <Txt size={12} color={colors.textGhost} align="center" style={{ marginTop: 16 }}>
          واصل — بقيت دروس في هذه السلسلة
        </Txt>
      ) : null}
    </Screen>
  );
}
