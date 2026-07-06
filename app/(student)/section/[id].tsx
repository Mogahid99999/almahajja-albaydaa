/**
 * Section page — generic, reusable at every level of the content tree.
 *
 * Route: /section/[id]  (group: (student))
 * Handles العقيدة, التوحيد, كتاب التوحيد, etc. — same template for all depths.
 *
 * Composition (top → bottom inside <Screen bottomPad={118}>):
 *   SectionNavBar
 *   SectionHeaderBadge   (conditional on section.showHeader)
 *   meta row             (sheikh Chips + lecture count)
 *   ProgressCard
 *   SubsectionsScroller  (conditional on subsections.length > 0)
 *   <SectionTitle> "محاضرات القسم"
 *   <Card padded={false}>  ← all lectures, separated by <Divider />
 *
 * Design ref: screens/صفحة القسم.dc.html
 */
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { arLectureCount } from '@/lib/format';
import { colors, spacing } from '@/constants/theme';
import { useSectionPage } from '@/hooks/useSections';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import type { LectureRow } from '@/api/types';

import { Chip } from '@/components/ui/Chip';
import { Divider } from '@/components/ui/Divider';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import { cardRowStyle } from '@/components/ui/cardRowStyle';

import { LectureRowItem } from '@/components/section/LectureRowItem';
import { ProgressCard } from '@/components/section/ProgressCard';
import { SectionHeaderBadge } from '@/components/section/SectionHeaderBadge';
import { SectionNavBar } from '@/components/section/SectionNavBar';
import { SubsectionsScroller } from '@/components/section/SubsectionsScroller';
import { AttachmentList } from '@/components/attachments/AttachmentList';
import { QuizListCard } from '@/components/quiz/QuizListCard';

export default function SectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, refetch } = useSectionPage(id ?? '');
  const lectures = data?.lectures ?? [];
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  const renderLecture = useCallback(
    ({ item, index }: { item: LectureRow; index: number }) => (
      <View
        style={[
          cardRowStyle(index === 0, index === lectures.length - 1),
          { marginHorizontal: spacing.screenH },
        ]}
      >
        <LectureRowItem lecture={item} />
      </View>
    ),
    [lectures.length],
  );

  const lectureSeparator = useCallback(
    () => (
      <View style={{ marginHorizontal: spacing.screenH }}>
        <Divider />
      </View>
    ),
    [],
  );

  // ── Loading ─────────────────────────────────────────────────────────────────
  // Spinner only on a genuinely cold cache. With keepPreviousData + the persisted
  // cache (V10), a revisit or a prefetched section already has `data`, so we render
  // it immediately and refetch silently in the background — no spinner over content.
  if (isLoading && !data) {
    return (
      <Screen scroll={false} padded bottomPad={0}>
        <SectionNavBar contextLabel={null} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  // ── Not found / error ────────────────────────────────────────────────────────
  if (!data) {
    return (
      <Screen scroll={false} padded bottomPad={118}>
        <SectionNavBar contextLabel={null} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center">
            القسم غير موجود
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            لا يمكن تحميل بيانات هذا القسم
          </Txt>
        </View>
      </Screen>
    );
  }

  const { section, parentTitle, sheikhNames, rollup, subsections, attachments, quizzes } = data;

  // The nav bar label is the parent title (breadcrumb context), or the section
  // title itself when this is a root-level section (parentTitle is null).
  const navLabel = parentTitle ?? section.title;

  const listHeader = (
    <>
      {/* ── Nav bar ─────────────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.screenH }}>
        <SectionNavBar contextLabel={navLabel} />
      </View>

      {/* ── Header badge (optional) ─────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.screenH, marginTop: 10 }}>
        <SectionHeaderBadge
          title={section.title}
          description={section.description}
          showHeader={section.showHeader}
        />
      </View>

      {/* ── Meta row: sheikh chips + lecture count ───────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: spacing.screenH,
          marginTop: section.showHeader ? 14 : 10,
        }}
      >
        {sheikhNames.map((name) => (
          <Chip key={name} label={name} bullet />
        ))}
        <Txt size={12} color={colors.textGhost} tabular>
          {arLectureCount(rollup.total)}
        </Txt>
      </View>

      {/* ── Progress card ───────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.screenH }}>
        <ProgressCard
          progressPct={rollup.progressPct}
          completed={rollup.completed}
          total={rollup.total}
        />
      </View>

      {/* ── Sub-sections horizontal scroller ────────────────────────────────── */}
      {subsections.length > 0 ? (
        <View style={{ paddingHorizontal: spacing.screenH }}>
          <SubsectionsScroller subsections={subsections} />
        </View>
      ) : null}

      {/* ── Lectures list title ───────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.screenH, marginTop: 26 }}>
        <SectionTitle title="محاضرات القسم" />
      </View>
    </>
  );

  const listFooter = (
    <>
      {/* ── Quizzes (PRD §12) ────────────────────────────────────────────────── */}
      {quizzes.length > 0 ? (
        <View style={{ paddingHorizontal: spacing.screenH, marginTop: 26 }}>
          <QuizListCard quizzes={quizzes} isChildNode={parentTitle != null} />
        </View>
      ) : null}

      {/* ── Attachments (PRD §13) ────────────────────────────────────────────── */}
      {attachments.length > 0 ? (
        <View style={{ paddingHorizontal: spacing.screenH, marginTop: 26 }}>
          <AttachmentList attachments={attachments} />
        </View>
      ) : null}
    </>
  );

  return (
    <Screen
      scroll={false}
      padded
      // bottomPad moves INTO the FlatList content below — reserving it on the
      // outer container (with scroll={false}) would sit the list inside the pad
      // and clip the quizzes/attachments footer, leaving a dead band above the
      // nav bar (the owner's screenshot). miniPad is 0 when nothing is playing.
      bottomPad={0}
      // Nav bar needs negative margin to break out of screen padding — we give
      // the Screen no horizontal padding and handle it inside SectionNavBar.
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: miniPad + insets.bottom + 24 }}
        data={lectures}
        keyExtractor={(lecture) => lecture.id}
        renderItem={renderLecture}
        ItemSeparatorComponent={lectureSeparator}
        initialNumToRender={10}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          /* Quiet empty state — no lectures in this section yet */
          <View
            style={{
              paddingHorizontal: spacing.screenH,
              paddingVertical: 32,
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Txt size={13} color={colors.textMuted} align="center">
              لا توجد محاضرات في هذا القسم بعد
            </Txt>
            <Txt size={11} color={colors.textGhost} align="center">
              تابع قريباً
            </Txt>
          </View>
        }
      />
    </Screen>
  );
}
