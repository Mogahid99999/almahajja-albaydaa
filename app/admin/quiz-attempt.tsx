/**
 * Admin attempt drill-down — /admin/quiz-attempt?id= (PRD §12.5).
 *
 * One student's attempt: per-question right/wrong with the chosen and correct
 * options, completion time, and the student's other attempts.
 *
 * 0166 التصحيح اليدوي: an attempt «بانتظار التصحيح» is graded here. MCQ rows stay
 * read-only with the system's points; each written row shows the full answer
 * and the model answer, then «درجة الطالب [ ] / N» (0..N, whole numbers) and an
 * optional «ملاحظة للطالب». The live final score (MCQ + written) and the pass
 * line sit above «اعتماد التصحيح وإرسال النتيجة», which stays disabled until
 * every written question has a valid score. The server re-checks all of it.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import type { AdminAttemptAnswer } from '@/api/types';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { parseGrade, toLatinDigits } from '@/components/quiz/grading';
import { useAdminAttemptDetail, useGradeAttempt } from '@/hooks/useQuizzes';
import { arabicOr } from '@/lib/errorText';
import { arDuration, arNum, toArabicDigits } from '@/lib/format';

function formatDateTime(iso: string | null | undefined): string {
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

function attemptStatus(a: {
  submittedAt: string | null;
  passed: boolean | null;
  gradingStatus?: 'pending' | 'graded' | null;
}): { label: string; color: string } {
  if (a.submittedAt == null) return { label: 'لم يكمل', color: colors.accentBrassMuted };
  if (a.gradingStatus === 'pending') return { label: 'بانتظار التصحيح', color: colors.accentBrassMuted };
  return a.passed
    ? { label: 'اجتاز', color: colors.stateSuccess }
    : { label: 'لم يجتز', color: colors.stateDanger };
}

/** One read-only MCQ row (unchanged look) + the points the system gave it. */
function McqAnswerCard({ a, index }: { a: AdminAttemptAnswer; index: number }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Feather
          name={a.isCorrect ? 'check-circle' : 'x-circle'}
          size={17}
          color={a.isCorrect ? colors.stateSuccess : colors.stateDanger}
          style={{ marginTop: 3 }}
        />
        <View style={{ flex: 1, gap: 7 }}>
          <View style={styles.questionHead}>
            <Txt size={14} weight="semibold" color={colors.textInk} style={{ flex: 1, lineHeight: 24 }}>
              {`${arNum(index + 1)}. ${a.text}`}
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
          {a.awardedPoints != null ? (
            <Txt size={12} color={colors.textMuted} tabular>
              {`الدرجة (تلقائيًا): ${arNum(a.awardedPoints)} / ${arNum(a.points)}`}
            </Txt>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

export default function AdminQuizAttemptScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const attemptId = typeof id === 'string' ? id : '';
  const { data: detail, isLoading } = useAdminAttemptDetail(attemptId);
  const grade = useGradeAttempt();

  const [grades, setGrades] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const hydratedRef = useRef<string | null>(null);

  const pending = detail?.gradingStatus === 'pending';
  const written = useMemo(
    () => (detail?.answers ?? []).filter((a) => a.kind === 'text'),
    [detail],
  );

  // Seed the fields once per attempt: an unanswered written question starts at
  // 0 (there is nothing to grade); anything already stored is shown as is.
  useEffect(() => {
    if (!detail || hydratedRef.current === detail.attemptId) return;
    hydratedRef.current = detail.attemptId;
    const g: Record<string, string> = {};
    const n: Record<string, string> = {};
    for (const a of detail.answers) {
      if (a.kind !== 'text') continue;
      if (a.awardedPoints != null) g[a.questionId] = String(a.awardedPoints);
      else if (!a.textAnswer) g[a.questionId] = '0';
      if (a.graderNote) n[a.questionId] = a.graderNote;
    }
    setGrades(g);
    setNotes(n);
    setError('');
    setSuccess('');
  }, [detail]);

  const parsed = written.map((a) => parseGrade(grades[a.questionId], a.points));
  const allGraded = parsed.every((p) => p != null);
  const writtenTotal = parsed.reduce<number>((s, p) => s + (p ?? 0), 0);
  const finalScore = (detail?.mcqScore ?? 0) + writtenTotal;
  const wouldPass = detail ? finalScore >= detail.passScore : false;

  function submitGrades() {
    if (!detail || !allGraded) return;
    setError('');
    grade.mutate(
      {
        attemptId: detail.attemptId,
        grades: written.map((a, i) => ({
          questionId: a.questionId,
          points: parsed[i]!,
          note: (notes[a.questionId] ?? '').trim() || null,
        })),
      },
      {
        onSuccess: () => setSuccess('تم اعتماد التصحيح وإرسال النتيجة إلى الطالب.'),
        onError: (e) => setError(arabicOr(e, 'تعذّر اعتماد التصحيح. حاول مرة أخرى.')),
        onSettled: () => setConfirming(false),
      },
    );
  }

  const status = detail ? attemptStatus(detail) : null;

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

      {isLoading || !detail || !status ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : (
        <>
          {success ? (
            <View style={styles.successBanner}>
              <Feather name="check-circle" size={16} color={colors.stateSuccess} />
              <Txt size={13} color={colors.stateSuccess} style={{ flex: 1 }}>
                {success}
              </Txt>
            </View>
          ) : null}

          {/* Attempt meta */}
          <Card style={{ marginBottom: 20 }}>
            <View style={styles.metaRow}>
              <MetaItem label="الحالة" value={status.label} color={status.color} />
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
              {detail.gradingStatus === 'graded' ? (
                <MetaItem
                  label="التصحيح"
                  value={`${detail.gradedByName ?? '—'} · ${formatDateTime(detail.gradedAt)}`}
                />
              ) : null}
            </View>
          </Card>

          {/* Answers */}
          <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 12 }}>
            الإجابات
          </Txt>
          <View style={{ gap: 12, marginBottom: 24 }}>
            {detail.answers.map((a, i) =>
              a.kind !== 'text' ? (
                <McqAnswerCard key={a.questionId} a={a} index={i} />
              ) : (
                <Card key={a.questionId}>
                  <View style={{ gap: 10 }}>
                    <View style={styles.questionHead}>
                      <Feather name="edit-3" size={15} color={colors.primaryTeal} style={{ marginTop: 4 }} />
                      <Txt
                        size={14}
                        weight="semibold"
                        color={colors.textInk}
                        style={{ flex: 1, lineHeight: 24 }}
                      >
                        {`${arNum(i + 1)}. ${a.text}`}
                      </Txt>
                      <Txt size={11.5} color={colors.textGhost} tabular>
                        {`الدرجة القصوى: ${arNum(a.points)}`}
                      </Txt>
                    </View>

                    <View style={styles.answerBox}>
                      <Txt size={12} weight="semibold" color={colors.textMuted}>
                        إجابة الطالب
                      </Txt>
                      <Txt
                        size={13.5}
                        color={a.textAnswer ? colors.textInk : colors.textGhost}
                        style={{ lineHeight: 24 }}
                        selectable
                      >
                        {a.textAnswer || 'لم يكتب الطالب إجابة لهذا السؤال.'}
                      </Txt>
                    </View>

                    {a.modelAnswer ? (
                      <View style={{ gap: 3 }}>
                        <Txt size={12} weight="semibold" color={colors.stateSuccess}>
                          الإجابة النموذجية
                        </Txt>
                        <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22 }}>
                          {a.modelAnswer}
                        </Txt>
                      </View>
                    ) : null}

                    {pending ? (
                      <>
                        <View style={styles.gradeRow}>
                          <Txt size={13} weight="semibold" color={colors.textSlate}>
                            درجة الطالب:
                          </Txt>
                          <TextInput
                            value={grades[a.questionId] ?? ''}
                            onChangeText={(t) =>
                              setGrades((prev) => ({
                                ...prev,
                                [a.questionId]: toLatinDigits(t).replace(/[^0-9]/g, ''),
                              }))
                            }
                            keyboardType="number-pad"
                            maxLength={4}
                            accessibilityLabel={`درجة السؤال ${i + 1}`}
                            style={[
                              styles.gradeInput,
                              (grades[a.questionId] ?? '') !== '' &&
                                parseGrade(grades[a.questionId], a.points) == null &&
                                styles.gradeInputBad,
                            ]}
                          />
                          <Txt size={13} color={colors.textMuted} tabular>
                            {`/ ${arNum(a.points)}`}
                          </Txt>
                        </View>
                        {(grades[a.questionId] ?? '') !== '' &&
                        parseGrade(grades[a.questionId], a.points) == null ? (
                          <Txt size={11.5} color={colors.stateDanger}>
                            {`الدرجة من ٠ إلى ${arNum(a.points)}`}
                          </Txt>
                        ) : null}
                        <TextInput
                          value={notes[a.questionId] ?? ''}
                          onChangeText={(t) => setNotes((prev) => ({ ...prev, [a.questionId]: t }))}
                          placeholder="ملاحظة للطالب — اختياري"
                          placeholderTextColor={colors.textGhost}
                          textAlign="right"
                          multiline
                          maxLength={2000}
                          style={styles.noteInput}
                        />
                      </>
                    ) : (
                      <>
                        <Txt size={13} weight="semibold" color={colors.primaryTeal} tabular>
                          {a.awardedPoints != null
                            ? `الدرجة: ${arNum(a.awardedPoints)} / ${arNum(a.points)}`
                            : 'لم تُصحَّح بعد'}
                        </Txt>
                        {a.graderNote ? (
                          <View style={{ gap: 3 }}>
                            <Txt size={12} weight="semibold" color={colors.accentBrassMuted}>
                              ملاحظة المصحح
                            </Txt>
                            <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22 }}>
                              {a.graderNote}
                            </Txt>
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                </Card>
              ),
            )}
          </View>

          {/* Approve */}
          {pending ? (
            <Card style={{ marginBottom: 24, gap: 10, maxWidth: 700 }}>
              <View style={styles.finalRow}>
                <Txt size={13} color={colors.textMuted}>
                  الدرجة النهائية
                </Txt>
                <Txt weight="semibold" size={20} color={colors.primaryTeal} tabular>
                  {allGraded
                    ? `${arNum(finalScore)} من ${arNum(detail.totalScore)}`
                    : `— من ${arNum(detail.totalScore)}`}
                </Txt>
              </View>
              <Txt size={12} color={colors.textGhost} tabular>
                {`الاختيار من متعدد (تلقائيًا): ${arNum(detail.mcqScore ?? 0)} · الأسئلة النصية: ${allGraded ? arNum(writtenTotal) : '—'} · درجة النجاح: ${arNum(detail.passScore)}`}
              </Txt>
              {allGraded ? (
                <Txt
                  size={13}
                  weight="semibold"
                  color={wouldPass ? colors.stateSuccess : colors.stateDanger}
                >
                  {wouldPass ? 'النتيجة: اجتاز' : 'النتيجة: لم يجتز'}
                </Txt>
              ) : (
                <Txt size={12.5} color={colors.accentBrassMuted}>
                  ضع درجة لجميع الأسئلة النصية قبل الاعتماد.
                </Txt>
              )}
              {error ? (
                <Txt size={12.5} color={colors.stateDanger}>
                  {error}
                </Txt>
              ) : null}
              <Pressable
                onPress={() => setConfirming(true)}
                disabled={!allGraded || grade.isPending}
                accessibilityRole="button"
                accessibilityState={{ disabled: !allGraded || grade.isPending }}
                style={({ pressed }) => [
                  styles.approveBtn,
                  (!allGraded || grade.isPending) && styles.approveBtnDisabled,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Txt
                  weight="semibold"
                  size={14}
                  color={allGraded ? colors.onTealPrimary : colors.textMuted}
                >
                  {grade.isPending ? 'جارٍ الاعتماد...' : 'اعتماد التصحيح وإرسال النتيجة'}
                </Txt>
              </Pressable>
            </Card>
          ) : null}

          {/* Other attempts */}
          {detail.otherAttempts.length > 0 ? (
            <>
              <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 12 }}>
                المحاولات الأخرى
              </Txt>
              <Card padded={false} style={{ overflow: 'hidden', maxWidth: 700 }}>
                {detail.otherAttempts.map((attempt, idx) => {
                  const st = attemptStatus(attempt);
                  return (
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
                        <Txt size={12.5} weight="semibold" color={st.color}>
                          {st.label}
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
                  );
                })}
              </Card>
            </>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={confirming}
        destructive={false}
        title="اعتماد التصحيح؟"
        message={`ستُعتمد الدرجة النهائية ${arNum(finalScore)} من ${arNum(detail?.totalScore ?? 0)}، ويصل إلى الطالب إشعار بأن نتيجته جاهزة.`}
        confirmLabel="اعتماد وإرسال"
        cancelLabel="تراجع"
        pending={grade.isPending}
        onConfirm={submitGrades}
        onCancel={() => setConfirming(false)}
      />
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

  questionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  } as ViewStyle,

  answerBox: {
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.sm,
    padding: 12,
    gap: 4,
  } as ViewStyle,

  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,

  gradeInput: {
    width: 72,
    height: 42,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textInk,
    textAlign: 'center',
  } as TextStyle,

  gradeInputBad: { borderColor: colors.stateDanger } as TextStyle,

  noteInput: {
    minHeight: 64,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textInk,
    textAlignVertical: 'top',
  } as TextStyle,

  finalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  } as ViewStyle,

  approveBtn: {
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...shadows.button,
  } as ViewStyle,

  approveBtnDisabled: {
    backgroundColor: colors.surfaceInset,
    shadowOpacity: 0,
    elevation: 0,
  } as ViewStyle,

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(31,138,91,0.08)',
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 16,
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
