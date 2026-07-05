/**
 * Admin quiz editor — /admin/quiz-edit[?id=] (create + edit; PRD §12.1).
 *
 * Mirrors the upload-form conventions: left column cards + sticky right rail
 * with the publish toggle. Total score is always the live sum of question
 * points (derived, never stored). Saving diff-upserts questions so existing
 * student answers survive unrelated edits (see src/api/quizzes.ts).
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { QuizQuestionInput } from '@/api/types';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { PublishToggle } from '@/components/admin/PublishToggle';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useAdminQuiz, useCreateQuiz, useUpdateQuiz } from '@/hooks/useQuizzes';
import { arNum, toArabicDigits } from '@/lib/format';

type EditableOption = { key: string; id?: string; text: string; isCorrect: boolean };
type EditableQuestion = { key: string; id?: string; text: string; points: string; options: EditableOption[] };

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

function blankOption(isCorrect = false): EditableOption {
  return { key: nextKey(), text: '', isCorrect };
}

function blankQuestion(): EditableQuestion {
  return {
    key: nextKey(),
    text: '',
    points: '1',
    options: [blankOption(true), blankOption()],
  };
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
      {children}
    </Txt>
  );
}

function CheckRow({
  label,
  hint,
  value,
  onToggle,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.checkRow, pressed && { opacity: 0.75 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
    >
      <Feather
        name={value ? 'check-square' : 'square'}
        size={18}
        color={value ? colors.primaryTeal : colors.textGhost}
      />
      <View style={{ flex: 1, marginRight: 10 }}>
        <Txt size={13.5} weight="semibold" color={colors.textInk}>
          {label}
        </Txt>
        <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 2 }}>
          {hint}
        </Txt>
      </View>
    </Pressable>
  );
}

export default function QuizEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof id === 'string' && id.length > 0 ? id : null;
  const { width } = useWindowDimensions();
  const narrow = width < 900;

  const { data: existing } = useAdminQuiz(editingId);
  const createQuiz = useCreateQuiz();
  const updateQuiz = useUpdateQuiz();

  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [passScore, setPassScore] = useState('');
  const [timeLimitMin, setTimeLimitMin] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('');
  const [order, setOrder] = useState('0');
  const [showResult, setShowResult] = useState(true);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [questions, setQuestions] = useState<EditableQuestion[]>([blankQuestion()]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!existing || hydratedRef.current === existing.id) return;
    hydratedRef.current = existing.id;
    setTitle(existing.title);
    setSectionId(existing.sectionId);
    setDescription(existing.description ?? '');
    setPassScore(String(existing.passScore));
    setTimeLimitMin(existing.timeLimitSec != null ? String(Math.round(existing.timeLimitSec / 60)) : '');
    setMaxAttempts(existing.maxAttempts != null ? String(existing.maxAttempts) : '');
    setOrder(String(existing.order));
    setShowResult(existing.showResult);
    setShowCorrectAnswers(existing.showCorrectAnswers);
    setStatus(existing.status);
    setQuestions(
      existing.questions.length > 0
        ? existing.questions.map((q) => ({
            key: nextKey(),
            id: q.id,
            text: q.text,
            points: String(q.points),
            options: q.options.map((o) => ({
              key: nextKey(),
              id: o.id,
              text: o.text,
              isCorrect: o.isCorrect,
            })),
          }))
        : [blankQuestion()],
    );
  }, [existing]);

  const totalScore = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  const saving = createQuiz.isPending || updateQuiz.isPending;

  function patchQuestion(key: string, patch: Partial<EditableQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  function patchOption(qKey: string, oKey: string, patch: Partial<EditableOption>) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.key === qKey
          ? { ...q, options: q.options.map((o) => (o.key === oKey ? { ...o, ...patch } : o)) }
          : q,
      ),
    );
  }

  function markCorrect(qKey: string, oKey: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.key === qKey
          ? { ...q, options: q.options.map((o) => ({ ...o, isCorrect: o.key === oKey })) }
          : q,
      ),
    );
  }

  function moveQuestion(index: number, delta: -1 | 1) {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function validate(): string {
    if (!title.trim()) return 'أدخل عنوان الاختبار.';
    if (!sectionId) return 'اختر القسم الذي يتعلق به الاختبار.';
    if (questions.length === 0) return 'أضف سؤالاً واحداً على الأقل.';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) return `أدخل نص السؤال ${toArabicDigits(i + 1)}.`;
      if ((Number(q.points) || 0) <= 0) return `أدخل درجة صحيحة للسؤال ${toArabicDigits(i + 1)}.`;
      const filled = q.options.filter((o) => o.text.trim());
      if (filled.length < 2) return `أضف خيارين على الأقل للسؤال ${toArabicDigits(i + 1)}.`;
      if (!q.options.some((o) => o.isCorrect && o.text.trim()))
        return `حدد الإجابة الصحيحة للسؤال ${toArabicDigits(i + 1)}.`;
    }
    const pass = Number(passScore) || 0;
    if (pass <= 0) return 'أدخل درجة النجاح.';
    if (pass > totalScore) return 'درجة النجاح أعلى من الدرجة الكلية.';
    return '';
  }

  function handleSave() {
    const problem = validate();
    setError(problem);
    setSuccessMsg('');
    if (problem) return;

    // Publishing fans out a real push notification to every opted-in student
    // (0018_quiz_publish_notify.sql) — confirm before an actual draft/new →
    // published transition. Re-saving an already-published quiz never
    // re-notifies (the DB trigger only fires on that transition), so it saves
    // straight through.
    if (status === 'published' && existing?.status !== 'published') {
      setConfirmingPublish(true);
      return;
    }
    doSave();
  }

  function doSave() {
    const input = {
      sectionId: sectionId!,
      title: title.trim(),
      description: description.trim() || null,
      passScore: Number(passScore),
      timeLimitSec: timeLimitMin ? Number(timeLimitMin) * 60 : null,
      maxAttempts: maxAttempts ? Number(maxAttempts) : null,
      showResult,
      showCorrectAnswers,
      status,
      order: Number(order) || 0,
    };
    const payload: QuizQuestionInput[] = questions.map((q, qi) => ({
      id: q.id,
      text: q.text.trim(),
      points: Number(q.points) || 1,
      order: qi,
      options: q.options
        .filter((o) => o.text.trim())
        .map((o, oi) => ({
          id: o.id,
          text: o.text.trim(),
          isCorrect: o.isCorrect,
          order: oi,
        })),
    }));

    if (editingId) {
      updateQuiz.mutate(
        { quizId: editingId, input, questions: payload },
        {
          onSuccess: () => setSuccessMsg('تم حفظ التعديلات.'),
          onError: () => setError('تعذّر الحفظ. حاول مرة أخرى.'),
          onSettled: () => setConfirmingPublish(false),
        },
      );
    } else {
      createQuiz.mutate(
        { input, questions: payload },
        {
          onSuccess: (newId) => {
            setSuccessMsg(
              status === 'published' ? 'تم نشر الاختبار وسيظهر للطلاب.' : 'تم حفظ الاختبار كمسودة.',
            );
            router.replace(`/admin/quiz-edit?id=${newId}` as Parameters<typeof router.replace>[0]);
          },
          onError: () => setError('تعذّر الحفظ. حاول مرة أخرى.'),
          onSettled: () => setConfirmingPublish(false),
        },
      );
    }
  }

  const content = (
    <View style={[styles.grid, narrow && styles.gridNarrow]}>
      {/* ── Left column ── */}
      <View style={styles.leftCol}>
        {successMsg ? (
          <View style={styles.successBanner}>
            <Feather name="check-circle" size={16} color={colors.stateSuccess} />
            <Txt size={13} color={colors.stateSuccess} style={{ marginRight: 8, flex: 1 }}>
              {successMsg}
            </Txt>
            <Pressable onPress={() => setSuccessMsg('')}>
              <Feather name="x" size={14} color={colors.stateSuccess} />
            </Pressable>
          </View>
        ) : null}
        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-triangle" size={15} color={colors.stateDanger} />
            <Txt size={13} color={colors.stateDanger} style={{ marginRight: 8, flex: 1 }}>
              {error}
            </Txt>
          </View>
        ) : null}

        {/* Card 1: basic info */}
        <Card style={styles.sectionCard}>
          <Txt weight="semibold" size={15} color={colors.textInk} style={styles.cardTitle}>
            المعلومات الأساسية
          </Txt>

          <FieldLabel>عنوان الاختبار</FieldLabel>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="مثال: اختبار كتاب التوحيد"
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            style={styles.input}
          />

          <FieldLabel>القسم / العنصر</FieldLabel>
          <TreePicker value={sectionId} onChange={setSectionId} label="اختر القسم" />

          <FieldLabel>وصف مختصر (اختياري)</FieldLabel>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="يظهر للطالب قبل بدء الاختبار..."
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            multiline
            style={[styles.input, { height: 80, paddingTop: 12, textAlignVertical: 'top' }]}
          />
        </Card>

        {/* Card 2: settings */}
        <Card style={styles.sectionCard}>
          <Txt weight="semibold" size={15} color={colors.textInk} style={styles.cardTitle}>
            إعدادات الاختبار
          </Txt>

          <View style={styles.numRow}>
            <View style={{ flex: 1 }}>
              <FieldLabel>درجة النجاح</FieldLabel>
              <TextInput
                value={passScore}
                onChangeText={(t) => setPassScore(t.replace(/[^0-9]/g, ''))}
                placeholder={toArabicDigits('5')}
                placeholderTextColor={colors.textGhost}
                keyboardType="numeric"
                textAlign="center"
                style={styles.numInput}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>الزمن بالدقائق</FieldLabel>
              <TextInput
                value={timeLimitMin}
                onChangeText={(t) => setTimeLimitMin(t.replace(/[^0-9]/g, ''))}
                placeholder="بدون تحديد"
                placeholderTextColor={colors.textGhost}
                keyboardType="numeric"
                textAlign="center"
                style={styles.numInput}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>عدد المحاولات</FieldLabel>
              <TextInput
                value={maxAttempts}
                onChangeText={(t) => setMaxAttempts(t.replace(/[^0-9]/g, ''))}
                placeholder="غير محدود"
                placeholderTextColor={colors.textGhost}
                keyboardType="numeric"
                textAlign="center"
                style={styles.numInput}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>الترتيب</FieldLabel>
              <TextInput
                value={order}
                onChangeText={(t) => setOrder(t.replace(/[^0-9]/g, ''))}
                placeholder={toArabicDigits('0')}
                placeholderTextColor={colors.textGhost}
                keyboardType="numeric"
                textAlign="center"
                style={styles.numInput}
              />
            </View>
          </View>

          <View style={{ marginTop: 16, gap: 4 }}>
            <CheckRow
              label="إظهار النتيجة بعد التسليم"
              hint="يرى الطالب درجته واجتيازه فور التسليم."
              value={showResult}
              onToggle={() => setShowResult((v) => !v)}
            />
            <CheckRow
              label="إظهار الإجابات الصحيحة"
              hint="يرى الطالب تصحيح كل سؤال بعد التسليم."
              value={showCorrectAnswers}
              onToggle={() => setShowCorrectAnswers((v) => !v)}
            />
          </View>
        </Card>

        {/* Card 3: questions builder */}
        <Card style={styles.sectionCard}>
          <View style={styles.questionsHeader}>
            <Txt size={12.5} color={colors.textMuted} tabular>
              {`الدرجة الكلية: ${arNum(totalScore)}`}
            </Txt>
            <Txt weight="semibold" size={15} color={colors.textInk}>
              الأسئلة
            </Txt>
          </View>

          <View style={{ gap: 18 }}>
            {questions.map((q, qi) => (
              <View key={q.key} style={styles.questionBox}>
                <View style={styles.questionTopRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    {qi > 0 ? (
                      <Pressable
                        onPress={() => moveQuestion(qi, -1)}
                        hitSlop={6}
                        style={styles.smallIconBtn}
                        accessibilityLabel="نقل لأعلى"
                      >
                        <Feather name="chevron-up" size={15} color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                    {qi < questions.length - 1 ? (
                      <Pressable
                        onPress={() => moveQuestion(qi, 1)}
                        hitSlop={6}
                        style={styles.smallIconBtn}
                        accessibilityLabel="نقل لأسفل"
                      >
                        <Feather name="chevron-down" size={15} color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => setQuestions((prev) => prev.filter((x) => x.key !== q.key))}
                      hitSlop={6}
                      style={styles.smallIconBtn}
                      accessibilityLabel="حذف السؤال"
                    >
                      <Feather name="trash-2" size={15} color={colors.stateDanger} />
                    </Pressable>
                  </View>
                  <Txt weight="semibold" size={13.5} color={colors.textSlate} tabular>
                    {`السؤال ${arNum(qi + 1)}`}
                  </Txt>
                </View>

                <TextInput
                  value={q.text}
                  onChangeText={(t) => patchQuestion(q.key, { text: t })}
                  placeholder="نص السؤال..."
                  placeholderTextColor={colors.textGhost}
                  textAlign="right"
                  multiline
                  style={[styles.input, { minHeight: 54, paddingTop: 12, textAlignVertical: 'top' }]}
                />

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <Txt size={12.5} color={colors.textMuted}>
                    درجة السؤال
                  </Txt>
                  <TextInput
                    value={q.points}
                    onChangeText={(t) => patchQuestion(q.key, { points: t.replace(/[^0-9]/g, '') })}
                    keyboardType="numeric"
                    textAlign="center"
                    style={[styles.numInput, { width: 70, height: 38 }]}
                  />
                </View>

                <View style={{ marginVertical: 12 }}>
                  <Divider />
                </View>

                <View style={{ gap: 8 }}>
                  {q.options.map((o) => (
                    <View key={o.key} style={styles.optionRow}>
                      <Pressable
                        onPress={() => markCorrect(q.key, o.key)}
                        hitSlop={6}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: o.isCorrect }}
                        accessibilityLabel="الإجابة الصحيحة"
                        style={styles.radioOuter}
                      >
                        <View
                          style={[
                            styles.radioRing,
                            o.isCorrect && { borderColor: colors.stateSuccess },
                          ]}
                        >
                          {o.isCorrect ? <View style={styles.radioDot} /> : null}
                        </View>
                      </Pressable>
                      <TextInput
                        value={o.text}
                        onChangeText={(t) => patchOption(q.key, o.key, { text: t })}
                        placeholder="نص الخيار..."
                        placeholderTextColor={colors.textGhost}
                        textAlign="right"
                        style={[styles.input, { flex: 1, height: 42 }]}
                      />
                      {q.options.length > 2 ? (
                        <Pressable
                          onPress={() =>
                            setQuestions((prev) =>
                              prev.map((x) =>
                                x.key === q.key
                                  ? {
                                      ...x,
                                      options: (() => {
                                        const rest = x.options.filter((y) => y.key !== o.key);
                                        return o.isCorrect && rest.length > 0
                                          ? rest.map((y, yi) => ({ ...y, isCorrect: yi === 0 }))
                                          : rest;
                                      })(),
                                    }
                                  : x,
                              ),
                            )
                          }
                          hitSlop={6}
                          style={styles.smallIconBtn}
                          accessibilityLabel="حذف الخيار"
                        >
                          <Feather name="x" size={15} color={colors.textGhost} />
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>

                <Pressable
                  onPress={() =>
                    setQuestions((prev) =>
                      prev.map((x) =>
                        x.key === q.key ? { ...x, options: [...x.options, blankOption()] } : x,
                      ),
                    )
                  }
                  style={({ pressed }) => [styles.addOptionBtn, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                >
                  <Feather name="plus" size={13} color={colors.primaryTeal} />
                  <Txt size={12.5} weight="semibold" color={colors.primaryTeal} style={{ marginRight: 6 }}>
                    إضافة خيار
                  </Txt>
                </Pressable>

                <Txt size={11} color={colors.textGhost} style={{ marginTop: 8 }}>
                  حدد الدائرة بجانب الإجابة الصحيحة (إجابة واحدة لكل سؤال).
                </Txt>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => setQuestions((prev) => [...prev, blankQuestion()])}
            style={({ pressed }) => [styles.addQuestionBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Feather name="plus-circle" size={16} color={colors.primaryTeal} />
            <Txt size={13.5} weight="semibold" color={colors.primaryTeal} style={{ marginRight: 8 }}>
              إضافة سؤال
            </Txt>
          </Pressable>
        </Card>
      </View>

      {/* ── Right rail ── */}
      <View style={[styles.rightRail, narrow && styles.rightRailNarrow, !narrow && styles.rightRailSticky]}>
        <Card style={{ gap: 0 }}>
          <Txt weight="semibold" size={14} color={colors.textInk} style={styles.cardTitle}>
            حالة النشر
          </Txt>
          <PublishToggle value={status} onChange={setStatus} />

          <View style={styles.metaDivider} />

          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textInk} weight="semibold" tabular>
              {arNum(questions.length)}
            </Txt>
            <Txt size={12} color={colors.textMuted}>عدد الأسئلة</Txt>
          </View>
          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textInk} weight="semibold" tabular>
              {arNum(totalScore)}
            </Txt>
            <Txt size={12} color={colors.textMuted}>الدرجة الكلية</Txt>
          </View>
          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textInk} weight="semibold" tabular>
              {passScore ? arNum(Number(passScore)) : '—'}
            </Txt>
            <Txt size={12} color={colors.textMuted}>درجة النجاح</Txt>
          </View>

          <View style={styles.metaDivider} />

          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.submitBtn,
              { opacity: pressed || saving ? 0.6 : 1 },
              status === 'published' && styles.submitBtnPublished,
            ]}
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {saving ? 'جارٍ الحفظ...' : status === 'published' ? 'حفظ ونشر' : 'حفظ كمسودة'}
            </Txt>
          </Pressable>
        </Card>
      </View>
    </View>
  );

  return (
    <AdminShell
      active="quizzes"
      breadcrumb={editingId ? 'الاختبارات / تعديل اختبار' : 'الاختبارات / اختبار جديد'}
    >
      <View style={styles.pageHeader}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
        >
          <Txt weight="semibold" size={13} color={colors.textMuted}>
            رجوع
          </Txt>
        </Pressable>
        <View>
          <Txt weight="display" size={27} color={colors.primaryTeal}>
            {editingId ? 'تعديل اختبار' : 'اختبار جديد'}
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
            يتعلق الاختبار بقسم رئيسي أو عنصر داخلي، ويظهر على صفحته بعد النشر
          </Txt>
        </View>
      </View>

      {content}

      <ConfirmDialog
        visible={confirmingPublish}
        destructive={false}
        title="نشر الاختبار؟"
        message="سيصل إشعار فوري إلى جميع الدارسين بأن هذا الاختبار متاح الآن."
        confirmLabel="نشر"
        cancelLabel="تراجع"
        pending={saving}
        onConfirm={doSave}
        onCancel={() => setConfirmingPublish(false)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  } as ViewStyle,

  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
  } as ViewStyle,

  grid: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
  } as ViewStyle,

  gridNarrow: { flexDirection: 'column' } as ViewStyle,

  leftCol: { flex: 1, gap: 20 } as ViewStyle,

  rightRail: { width: 320, gap: 16 } as ViewStyle,

  rightRailNarrow: { width: '100%' } as ViewStyle,

  rightRailSticky: {
    position: 'sticky' as any,
    top: 30,
  } as ViewStyle,

  sectionCard: { gap: 0 } as ViewStyle,

  cardTitle: { marginBottom: 16 } as TextStyle,

  fieldLabel: { marginBottom: 7, marginTop: 14 } as TextStyle,

  input: {
    minHeight: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  numRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  } as ViewStyle,

  numInput: {
    height: 46,
    minWidth: 90,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textInk,
    textAlign: 'center',
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  } as ViewStyle,

  questionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  } as ViewStyle,

  questionBox: {
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.card,
    backgroundColor: colors.bgSandRaised,
    padding: 14,
  } as ViewStyle,

  questionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  } as ViewStyle,

  smallIconBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  radioOuter: {
    width: 34,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  radioRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.stateSuccess,
  } as ViewStyle,

  addOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 6,
  } as ViewStyle,

  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primaryTeal,
    backgroundColor: 'rgba(31,74,66,0.04)',
  } as ViewStyle,

  metaDivider: {
    height: 1,
    backgroundColor: colors.borderHair,
    marginVertical: 14,
  } as ViewStyle,

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  } as ViewStyle,

  submitBtn: {
    backgroundColor: colors.primaryTeal,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  submitBtnPublished: {
    backgroundColor: colors.stateSuccess,
  } as ViewStyle,

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31,138,91,0.09)',
    borderRadius: radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(31,138,91,0.2)',
  } as ViewStyle,

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(184,92,74,0.09)',
    borderRadius: radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(184,92,74,0.2)',
  } as ViewStyle,
});
