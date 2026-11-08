/**
 * «بانتظار التصحيح» — /admin/quiz-grading (migration 0166).
 *
 * Every submitted attempt whose written answers still need a grader, oldest
 * first, across all quizzes. A row opens the attempt (/admin/quiz-attempt),
 * where the grader scores each written answer and approves the result. Open to
 * admin · sheikh · publisher — the RPC enforces the same rule server-side.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { usePendingGradings } from '@/hooks/useQuizzes';
import { arNum, toArabicDigits } from '@/lib/format';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return toArabicDigits(
    `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  );
}

export default function QuizGradingQueueScreen() {
  const router = useRouter();
  const { data: rows = [], isLoading, isError, refetch } = usePendingGradings();

  return (
    <AdminShell active="quizzes" breadcrumb="الاختبارات / بانتظار التصحيح">
      <View style={styles.pageHeader}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/quizzes'))}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <Txt weight="semibold" size={13} color={colors.textMuted}>
            رجوع
          </Txt>
        </Pressable>
        <View>
          <Txt weight="display" size={27} color={colors.primaryTeal}>
            {rows.length > 0 ? `بانتظار التصحيح (${arNum(rows.length)})` : 'بانتظار التصحيح'}
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
            محاولات فيها إجابات نصية تحتاج إلى درجة قبل اعتماد النتيجة
          </Txt>
        </View>
      </View>

      {isLoading ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : isError ? (
        <Card>
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
            <Txt size={13} color={colors.textMuted} align="center">
              تعذّر تحميل المحاولات.
            </Txt>
            <Pressable onPress={() => void refetch()} accessibilityRole="button">
              <Txt size={13} weight="semibold" color={colors.primaryTeal}>
                إعادة المحاولة
              </Txt>
            </Pressable>
          </View>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
            <Feather name="check-circle" size={26} color={colors.accentBrassSoft} />
            <Txt size={13.5} weight="semibold" color={colors.textMuted} align="center">
              لا توجد محاولات بانتظار التصحيح
            </Txt>
          </View>
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden', maxWidth: 860 }}>
          {rows.map((row, idx) => (
            <React.Fragment key={row.attemptId}>
              {idx > 0 ? <Divider /> : null}
              <Pressable
                onPress={() =>
                  router.push(
                    `/admin/quiz-attempt?id=${row.attemptId}` as Parameters<typeof router.push>[0],
                  )
                }
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSandRaised }]}
                accessibilityRole="button"
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
                    {row.displayName}
                  </Txt>
                  <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                    {[row.quizTitle, row.sectionTitle, `المحاولة ${arNum(row.attemptNo)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt size={12} color={colors.textMuted} tabular>
                    {formatDateTime(row.submittedAt)}
                  </Txt>
                  <Txt size={11.5} color={colors.accentBrassMuted} tabular>
                    {`${arNum(row.writtenCount)} ${row.writtenCount === 1 ? 'سؤال نصي' : 'أسئلة نصية'}`}
                  </Txt>
                </View>
                <Feather name="chevron-left" size={15} color={colors.textGhost} />
              </Pressable>
            </React.Fragment>
          ))}
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    minHeight: 62,
  } as ViewStyle,
});
