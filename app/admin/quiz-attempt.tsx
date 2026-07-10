/**
 * Admin attempt drill-down — /admin/quiz-attempt?id= (PRD §12.5).
 *
 * One student's attempt: per-question right/wrong with the chosen and correct
 * options, completion time, and the student's other attempts.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminAttemptDetail } from '@/hooks/useQuizzes';
import { arDuration, arNum, toArabicDigits } from '@/lib/format';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return toArabicDigits(
    `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  );
}

function MetaItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metaItem}>
      <Txt size={11.5} color={colors.textMuted}>
        {label}
      </Txt>
      <Txt size={14} weight="semibold" color={color ?? colors.textInk} tabular style={{ marginTop: 3 }}>
        {value}
      </Txt>
    </View>
  );
}

export default function AdminQuizAttemptScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const attemptId = typeof id === 'string' ? id : '';
  const { data: detail, isLoading } = useAdminAttemptDetail(attemptId);

  return (
    <AdminShell active="quizzes" breadcrumb="الاختبارات / النتائج / محاولة">
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
            {detail?.displayName ?? '...'}
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
            {detail ? `${detail.quizTitle} · المحاولة ${arNum(detail.attemptNo)}` : ''}
          </Txt>
        </View>
      </View>

      {isLoading || !detail ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : (
        <>
          {/* Attempt meta */}
          <Card style={{ marginBottom: 20 }}>
            <View style={styles.metaRow}>
              <MetaItem
                label="الحالة"
                value={
                  detail.submittedAt == null
                    ? 'لم يكمل'
                    : detail.passed
                      ? 'اجتاز'
                      : 'لم يجتز'
                }
                color={
                  detail.submittedAt == null
                    ? colors.accentBrassMuted
                    : detail.passed
                      ? colors.stateSuccess
                      : colors.stateDanger
                }
              />
              <MetaItem
                label="الدرجة"
                value={
                  detail.score != null
                    ? `${arNum(detail.score)} من ${arNum(detail.totalScore)}`
                    : '—'
                }
              />
              <MetaItem label="درجة النجاح" value={arNum(detail.passScore)} />
              <MetaItem
                label="زمن الإكمال"
                value={detail.durationSec != null ? arDuration(detail.durationSec) : '—'}
              />
              <MetaItem label="وقت التسليم" value={formatDateTime(detail.submittedAt)} />
            </View>
          </Card>

          {/* Answers */}
          <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 12 }}>
            الإجابات
          </Txt>
          <View style={{ gap: 12, marginBottom: 24 }}>
            {detail.answers.map((a, i) => (
              <Card key={a.questionId}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Feather
                    name={a.isCorrect ? 'check-circle' : 'x-circle'}
                    size={17}
                    color={a.isCorrect ? colors.stateSuccess : colors.stateDanger}
                    style={{ marginTop: 3 }}
                  />
                  <View style={{ flex: 1, gap: 7 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <Txt
                        size={14}
                        weight="semibold"
                        color={colors.textInk}
                        style={{ flex: 1, lineHeight: 24 }}
                      >
                        {`${arNum(i + 1)}. ${a.text}`}
                      </Txt>
                      <Txt size={11.5} color={colors.textGhost} tabular>
                        {`${arNum(a.points)} درجة`}
                      </Txt>
                    </View>
                    <Txt size={12.5} color={a.isCorrect ? colors.stateSuccess : colors.stateDanger}>
                      {a.selectedOptionText ? `إجابة الطالب: ${a.selectedOptionText}` : 'لم يُجب'}
                    </Txt>
                    {!a.isCorrect && a.correctOptionText ? (
                      <Txt size={12.5} color={colors.stateSuccess}>
                        {`الإجابة الصحيحة: ${a.correctOptionText}`}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              </Card>
            ))}
          </View>

          {/* Other attempts */}
          {detail.otherAttempts.length > 0 ? (
            <>
              <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 12 }}>
                المحاولات الأخرى
              </Txt>
              <Card padded={false} style={{ overflow: 'hidden', maxWidth: 700 }}>
                {detail.otherAttempts.map((attempt, idx) => (
                  <React.Fragment key={attempt.attemptId}>
                    {idx > 0 ? <Divider /> : null}
                    <Pressable
                      onPress={() =>
                        router.push(
                          `/admin/quiz-attempt?id=${attempt.attemptId}` as Parameters<typeof router.push>[0],
                        )
                      }
                      style={({ pressed }) => [
                        styles.attemptRow,
                        pressed && { backgroundColor: colors.bgSandRaised },
                      ]}
                      accessibilityRole="button"
                    >
                      <Txt size={13} weight="semibold" color={colors.textInk} tabular>
                        {`المحاولة ${arNum(attempt.attemptNo)}`}
                      </Txt>
                      <Txt
                        size={12.5}
                        weight="semibold"
                        color={
                          attempt.submittedAt == null
                            ? colors.accentBrassMuted
                            : attempt.passed
                              ? colors.stateSuccess
                              : colors.stateDanger
                        }
                      >
                        {attempt.submittedAt == null ? 'لم يكمل' : attempt.passed ? 'اجتاز' : 'لم يجتز'}
                      </Txt>
                      <Txt size={13} color={colors.textInk} tabular>
                        {attempt.score != null ? arNum(attempt.score) : '—'}
                      </Txt>
                      <Txt size={12} color={colors.textMuted} tabular>
                        {formatDateTime(attempt.submittedAt)}
                      </Txt>
                      <Feather name="chevron-left" size={15} color={colors.textGhost} />
                    </Pressable>
                  </React.Fragment>
                ))}
              </Card>
            </>
          ) : null}
        </>
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

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  } as ViewStyle,

  metaItem: {
    minWidth: 120,
  } as ViewStyle,

  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  } as ViewStyle,
});
