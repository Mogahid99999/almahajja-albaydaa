/**
 * Admin quiz results — /admin/quiz-results?id= (PRD §12.5).
 *
 * Summary tiles (entered/passed/failed/incomplete/not-taken/avg/max/min) and a
 * per-student table. Row tap opens the attempt drill-down. Admin-only surface —
 * students never see each other's results (§12.6).
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { AdminResultStatus } from '@/api/types';
import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminQuiz, useQuizResultRows, useQuizResultsSummary } from '@/hooks/useQuizzes';
import { arNum, toArabicDigits } from '@/lib/format';

const STATUS_LABEL: Record<AdminResultStatus, { label: string; color: string }> = {
  passed: { label: 'اجتاز', color: colors.stateSuccess },
  failed: { label: 'لم يجتز', color: colors.stateDanger },
  incomplete: { label: 'لم يكمل', color: colors.accentBrassMuted },
  exhausted: { label: 'استنفد المحاولات', color: colors.textMuted },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return toArabicDigits(
    `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`,
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card style={styles.tile}>
      <Txt weight="semibold" size={20} color={color ?? colors.primaryTeal} tabular>
        {value}
      </Txt>
      <Txt size={11.5} color={colors.textMuted} style={{ marginTop: 4 }}>
        {label}
      </Txt>
    </Card>
  );
}

export default function QuizResultsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const quizId = typeof id === 'string' ? id : '';

  const { data: quiz } = useAdminQuiz(quizId || null);
  const { data: summary } = useQuizResultsSummary(quizId);
  const { data: rows = [], isLoading } = useQuizResultRows(quizId);

  return (
    <AdminShell active="quizzes" breadcrumb="الاختبارات / النتائج">
      <View style={styles.pageHeader}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <Txt weight="semibold" size={13} color={colors.textMuted}>
            رجوع
          </Txt>
        </Pressable>
        <View>
          <Txt weight="display" size={27} color={colors.primaryTeal}>
            نتائج الاختبار
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
            {quiz ? quiz.title : '...'}
          </Txt>
        </View>
      </View>

      {/* Summary tiles */}
      {summary ? (
        <View style={styles.tiles}>
          <Tile label="دخلوا الاختبار" value={arNum(summary.entered)} />
          <Tile label="اجتازوا" value={arNum(summary.passedCount)} color={colors.stateSuccess} />
          <Tile label="لم يجتازوا" value={arNum(summary.failedCount)} color={colors.stateDanger} />
          <Tile label="لم يكملوا" value={arNum(summary.incompleteCount)} color={colors.accentBrassMuted} />
          <Tile label="لم يدخلوا (من المتابعين)" value={arNum(summary.notTaken)} color={colors.textMuted} />
          <Tile
            label="متوسط الدرجات"
            value={summary.avgScore != null ? toArabicDigits(String(summary.avgScore).replace('.', '٫')) : '—'}
          />
          <Tile label="أعلى درجة" value={summary.maxScore != null ? arNum(summary.maxScore) : '—'} />
          <Tile label="أدنى درجة" value={summary.minScore != null ? arNum(summary.minScore) : '—'} />
        </View>
      ) : null}

      {/* Per-student table */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 12, marginTop: 8 }}>
        الطلاب
      </Txt>
      {isLoading ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">
            لم يدخل أحد هذا الاختبار بعد.
          </Txt>
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {/* Header row */}
          <View style={[styles.tableRow, { backgroundColor: colors.bgSandRaised }]}>
            <Txt size={12} weight="semibold" color={colors.textSlate} style={styles.colName}>
              الطالب
            </Txt>
            <Txt size={12} weight="semibold" color={colors.textSlate} style={styles.colStatus}>
              الحالة
            </Txt>
            <Txt size={12} weight="semibold" color={colors.textSlate} style={styles.colNum} align="center">
              أفضل درجة
            </Txt>
            <Txt size={12} weight="semibold" color={colors.textSlate} style={styles.colNum} align="center">
              المحاولات
            </Txt>
            <Txt size={12} weight="semibold" color={colors.textSlate} style={styles.colDate} align="center">
              آخر محاولة
            </Txt>
            <View style={{ width: 24 }} />
          </View>
          {rows.map((row, idx) => {
            const meta = STATUS_LABEL[row.status];
            return (
              <React.Fragment key={row.userId}>
                {idx > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() =>
                    router.push(
                      `/admin/quiz-attempt?id=${row.lastAttemptId}` as Parameters<typeof router.push>[0],
                    )
                  }
                  style={({ pressed }) => [
                    styles.tableRow,
                    pressed && { backgroundColor: colors.bgSandRaised },
                  ]}
                  accessibilityRole="button"
                >
                  <Txt size={13} weight="semibold" color={colors.textInk} style={styles.colName} numberOfLines={1}>
                    {row.displayName}
                  </Txt>
                  <Txt size={12.5} weight="semibold" color={meta.color} style={styles.colStatus}>
                    {meta.label}
                  </Txt>
                  <Txt size={13} color={colors.textInk} style={styles.colNum} align="center" tabular>
                    {row.bestScore != null ? arNum(row.bestScore) : '—'}
                  </Txt>
                  <Txt size={13} color={colors.textInk} style={styles.colNum} align="center" tabular>
                    {arNum(row.attemptsUsed)}
                  </Txt>
                  <Txt size={12.5} color={colors.textMuted} style={styles.colDate} align="center" tabular>
                    {formatDate(row.lastAttemptAt)}
                  </Txt>
                  <Feather name="chevron-left" size={15} color={colors.textGhost} />
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  } as ViewStyle,

  backBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
  } as ViewStyle,

  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  } as ViewStyle,

  tile: {
    minWidth: 150,
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 18,
  } as ViewStyle,

  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 52,
  } as ViewStyle,

  colName: { flex: 2 } as TextStyle,
  colStatus: { flex: 1.2 } as TextStyle,
  colNum: { flex: 0.9 } as TextStyle,
  colDate: { flex: 1.1 } as TextStyle,
});
