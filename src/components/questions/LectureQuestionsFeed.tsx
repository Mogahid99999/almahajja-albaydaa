/**
 * «أسئلة المحاضرات» — the third tab of مساحة الأسئلة (0161).
 *
 * Display-only: every answered PUBLIC question asked inside any lesson, latest
 * answer first, each card linking back to its source lesson (the player). The
 * section chips are derived from the loaded feed. Asking stays inside the
 * lesson («أدوات الدرس» ← أسئلة الدرس), so there is no composer here.
 */
import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import type { LectureFeedQuestion, MyLectureQuestion } from '@/api/questions';
import { AnswerThread } from '@/components/questions/AnswerThread';
import { ReportSheet } from '@/components/reports/ReportSheet';
import { SourceLink } from '@/components/questions/SourceLink';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLectureQuestionsFeed, useMyLectureQuestions } from '@/hooks/useQuestions';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useReportContent } from '@/hooks/useReports';
import { arSince } from '@/lib/format';

type Row = LectureFeedQuestion | MyLectureQuestion;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && !active && { opacity: 0.7 }]}
    >
      <Txt size={12.5} weight={active ? 'semibold' : 'medium'} color={active ? colors.onTealPrimary : colors.textSlate}>
        {label}
      </Txt>
    </Pressable>
  );
}

function StatusBadge({ q }: { q: MyLectureQuestion }) {
  const answered = q.status === 'answered';
  return (
    <View style={[styles.badge, answered ? styles.badgeOk : styles.badgeWait]}>
      <Txt size={10.5} weight="semibold" color={answered ? colors.stateSuccess : colors.accentBrassMuted}>
        {answered ? 'مُجاب' : q.status === 'hidden' ? 'مخفي' : 'قيد المراجعة'}
      </Txt>
    </View>
  );
}

function QuestionCard({ q, mine, onReport }: { q: Row; mine: boolean; onReport: () => void }) {
  const pub = q as LectureFeedQuestion;
  const hasAnswer = !!(q.answerBody || q.answerAudioPath);
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={styles.meta}>
        {mine ? (
          <StatusBadge q={q as MyLectureQuestion} />
        ) : (
          <>
            <Feather name={pub.askerDisplay ? 'user' : 'user-x'} size={13} color={colors.textGhost} />
            <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1} style={{ flex: 1 }}>
              {pub.askerDisplay ?? 'سائل'}
            </Txt>
          </>
        )}
        {mine ? <View style={{ flex: 1 }} /> : null}
        <Txt size={11.5} color={colors.textGhost}>
          {arSince(q.answeredAt ?? q.createdAt)}
        </Txt>
        {!mine ? (
          <Pressable onPress={onReport} accessibilityLabel="الإبلاغ عن هذا السؤال" hitSlop={6}>
            <Feather name="flag" size={14} color={colors.textGhost} />
          </Pressable>
        ) : null}
      </View>
      <Txt size={14.5} weight="medium" color={colors.textInk} style={{ marginTop: 10, lineHeight: 24 }}>
        {q.body}
      </Txt>
      {hasAnswer ? (
        <View style={styles.answer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Feather name="message-circle" size={13} color={colors.primaryTeal600} />
            <Txt size={11.5} weight="semibold" color={colors.primaryTeal600}>
              جواب الشيخ
            </Txt>
          </View>
          <AnswerThread
            questionId={q.id}
            fallbackBody={q.answerBody}
            fallbackAudioPath={q.answerAudioPath}
            reportable={!mine}
          />
        </View>
      ) : null}
      <SourceLink src={q} />
    </Card>
  );
}

export function LectureQuestionsFeed({ headerTop, bottomPad = 0 }: { headerTop?: ReactNode; bottomPad?: number }) {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const [tab, setTab] = useState<'public' | 'mine'>('public');
  const [section, setSection] = useState<string | null>(null);
  const feed = useLectureQuestionsFeed();
  const mine = useMyLectureQuestions(!isGuest);
  const [reportTarget, setReportTarget] = useState<Row | null>(null);
  const reportContent = useReportContent();
  const { refreshing, onRefresh } = usePullToRefresh([() => feed.refetch(), () => mine.refetch()]);

  const source: Row[] = (tab === 'public' ? feed.data : mine.data) ?? [];
  // Section chips: only sections that actually have questions in this list.
  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of source) if (q.sectionId && q.sectionTitle && !seen.has(q.sectionId)) seen.set(q.sectionId, q.sectionTitle);
    return [...seen.entries()];
  }, [source]);
  const rows = section ? source.filter((q) => q.sectionId === section) : source;
  const loading = tab === 'public' ? feed.isLoading : mine.isLoading;

  const header = (
    <>
      {headerTop}
      <View style={styles.info}>
        <Feather name="info" size={15} color={colors.textGhost} />
        <Txt size={12} color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
          تُطرح هذه الأسئلة من داخل الدرس نفسه («أدوات الدرس» ← أسئلة الدرس)، وتُجمع هنا كلها.
        </Txt>
      </View>
      {sections.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Chip label="كل السلاسل" active={section === null} onPress={() => setSection(null)} />
          {sections.map(([id, title]) => (
            <Chip key={id} label={title} active={section === id} onPress={() => setSection(id)} />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.subTabs}>
        <Chip label="المجابة" active={tab === 'public'} onPress={() => { setTab('public'); setSection(null); }} />
        {!isGuest ? (
          <Chip label="أسئلتي" active={tab === 'mine'} onPress={() => { setTab('mine'); setSection(null); }} />
        ) : null}
      </View>
    </>
  );

  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      data={loading ? [] : rows}
      keyExtractor={(q) => q.id}
      renderItem={({ item }) => (
        <QuestionCard q={item} mine={tab === 'mine'} onReport={() => setReportTarget(item)} />
      )}
      initialNumToRender={8}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryTeal} colors={[colors.primaryTeal]} />
      }
      ListEmptyComponent={
        loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : (
          <View style={styles.empty}>
            <Feather name={tab === 'mine' ? 'edit-3' : 'help-circle'} size={24} color={colors.textGhost} />
            <Txt size={13.5} color={colors.textMuted} align="center">
              {tab === 'mine'
                ? 'لم تسأل في الدروس شيئاً بعد'
                : section
                  ? 'لا أسئلة مجابة في هذه السلسلة بعد'
                  : 'لا أسئلة مجابة في الدروس بعد'}
            </Txt>
            <Txt size={12} color={colors.textGhost} align="center" style={{ lineHeight: 19 }}>
              لطرح سؤال عن درس، افتحه ثم اختر «أسئلة الدرس» من أدوات الدرس.
            </Txt>
          </View>
        )
      }
      ListFooterComponent={
        <ReportSheet
          visible={!!reportTarget}
          pending={reportContent.isPending}
          error={reportContent.error instanceof Error ? reportContent.error.message : undefined}
          onClose={() => setReportTarget(null)}
          onSubmit={(reason) => {
            if (!reportTarget) return;
            reportContent.mutate(
              { contentType: 'question', contentId: reportTarget.id, reason: reason || undefined },
              { onSuccess: () => setReportTarget(null) },
            );
          }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
  },
  chipOn: { backgroundColor: colors.primaryTeal, borderColor: colors.primaryTeal },
  chipsRow: { gap: 8, paddingBottom: 12 },
  subTabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgSandRaised,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSand2,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  answer: {
    marginTop: 12,
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.input,
    padding: 12,
    borderRightWidth: 3,
    borderRightColor: colors.accentBrassSoft,
  },


  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeOk: { backgroundColor: 'rgba(31,138,91,0.1)' },
  badgeWait: { backgroundColor: 'rgba(201,164,99,0.16)' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 16 },
});
