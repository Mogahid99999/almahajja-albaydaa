/**
 * «شهادة إتمام» block of the admin section editor (migration 0168).
 *
 * Controlled: the parent (SectionEditor) owns the value and saves it together
 * with the section. Only the settings live here — issuing the certificate, its
 * design and the student's certificates screen are a later phase.
 */
import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View, type ViewStyle } from 'react-native';

import type {
  CertificateLectureRule,
  CertificateQuizOption,
  CertificateQuizRule,
  SaveSectionCertificateInput,
} from '@/api/certificates';
import { Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';

export type CertificateFormValue = Omit<SaveSectionCertificateInput, 'sectionId'>;

const LECTURE_OPTIONS: { value: CertificateLectureRule; label: string }[] = [
  { value: 'all', label: 'إكمال جميع المحاضرات' },
  { value: 'percent', label: 'نسبة من المحاضرات' },
];
const QUIZ_OPTIONS: { value: CertificateQuizRule; label: string }[] = [
  { value: 'none', label: 'لا يشترط اختبارات' },
  { value: 'selected', label: 'اختبارات محددة' },
];
const PCT_PRESETS = [70, 80, 90];

/** «٨٠» / "80" → 80; anything else → null. */
export function parsePct(text: string): number | null {
  const latin = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^0-9]/g, '');
  if (!latin) return null;
  return Math.min(Number(latin), 1000);
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Txt size={13} weight="semibold" color={active ? colors.onTealPrimary : colors.textMuted}>
              {opt.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CertificateSettingsFields({
  value,
  onChange,
  quizzes,
  sectionId,
  loading,
  loadError,
  validationError,
}: {
  value: CertificateFormValue;
  onChange: (next: CertificateFormValue) => void;
  quizzes: CertificateQuizOption[];
  sectionId: string;
  loading: boolean;
  loadError: boolean;
  validationError: string | null;
}) {
  const set = (patch: Partial<CertificateFormValue>) => onChange({ ...value, ...patch });

  if (loading) {
    return (
      <Txt size={12} color={colors.textMuted} style={styles.top}>
        جارٍ تحميل إعدادات الشهادة…
      </Txt>
    );
  }
  if (loadError) {
    return (
      <Txt size={12} color={colors.textMuted} style={styles.top}>
        تعذّر تحميل إعدادات الشهادة؛ تُحفظ بقية تعديلات القسم كالمعتاد.
      </Txt>
    );
  }

  function toggleQuiz(id: string) {
    const has = value.quizIds.includes(id);
    set({ quizIds: has ? value.quizIds.filter((q) => q !== id) : [...value.quizIds, id] });
  }

  return (
    <View style={styles.top}>
      <View style={styles.toggleRow}>
        <Switch
          value={value.enabled}
          onValueChange={(enabled) => set({ enabled })}
          thumbColor={value.enabled ? colors.primaryTeal : colors.textGhost}
          trackColor={{ false: colors.surfaceTrack, true: 'rgba(31,74,66,0.3)' }}
          accessibilityLabel="يمنح هذا القسم شهادة إتمام"
        />
        <View style={{ flex: 1, marginRight: 12 }}>
          <Txt size={13} weight="semibold" color={colors.textInk}>يمنح هذا القسم شهادة إتمام</Txt>
          <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
            تُحتسب محاضرات القسم وأقسامه الفرعية المنشورة
          </Txt>
        </View>
      </View>

      {value.enabled ? (
        <View style={styles.conditions}>
          <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
            شرط إكمال المحاضرات
          </Txt>
          <Segmented
            options={LECTURE_OPTIONS}
            value={value.lectureRule}
            onChange={(lectureRule) =>
              set({ lectureRule, lecturePct: lectureRule === 'percent' ? (value.lecturePct ?? 80) : null })
            }
          />
          {value.lectureRule === 'percent' ? (
            <View style={styles.pctRow}>
              <TextInput
                value={value.lecturePct === null ? '' : String(value.lecturePct)}
                onChangeText={(t) => set({ lecturePct: parsePct(t) })}
                keyboardType="number-pad"
                textAlign="center"
                maxLength={3}
                accessibilityLabel="النسبة المطلوبة من المحاضرات"
                style={styles.pctInput}
              />
              <Txt size={14} weight="semibold" color={colors.textSlate}>٪</Txt>
              <View style={styles.presets}>
                {PCT_PRESETS.map((p) => {
                  const active = value.lecturePct === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => set({ lecturePct: p })}
                      style={[styles.preset, active && styles.presetActive]}
                      accessibilityRole="button"
                    >
                      <Txt size={12} weight="semibold" color={active ? colors.onTealPrimary : colors.textMuted}>
                        {`${arNum(p)}٪`}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          <Txt size={12} color={colors.textMuted} style={{ marginTop: 6 }}>
            المحاضرة المكتملة تُحتسب سواء أُكملت من التسجيل أو بحضور البث المباشر
          </Txt>

          <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
            شرط الاختبارات
          </Txt>
          <Segmented
            options={QUIZ_OPTIONS}
            value={value.quizRule}
            onChange={(quizRule) => set({ quizRule })}
          />
          {value.quizRule === 'selected' ? (
            quizzes.length === 0 ? (
              <Txt size={12} color={colors.textMuted} style={{ marginTop: 8 }}>
                لا توجد اختبارات في هذا القسم بعد
              </Txt>
            ) : (
              <View style={styles.quizList}>
                {quizzes.map((q) => {
                  const checked = value.quizIds.includes(q.id);
                  return (
                    <Pressable
                      key={q.id}
                      onPress={() => toggleQuiz(q.id)}
                      style={({ pressed }) => [styles.quizRow, pressed && { opacity: 0.7 }]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                    >
                      <Feather
                        name={checked ? 'check-square' : 'square'}
                        size={18}
                        color={checked ? colors.primaryTeal : colors.textGhost}
                      />
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <Txt size={13} weight="semibold" color={colors.textInk}>{q.title}</Txt>
                        {q.sectionId !== sectionId || !q.published ? (
                          <Txt size={11} color={colors.textMuted} style={{ marginTop: 2 }}>
                            {[q.sectionId !== sectionId ? q.sectionTitle : null, q.published ? null : 'مسودة']
                              .filter(Boolean)
                              .join(' · ')}
                          </Txt>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : null}
          {value.quizRule === 'selected' ? (
            <Txt size={12} color={colors.textMuted} style={{ marginTop: 6 }}>
              يُعتمد نجاح كل اختبار بدرجة نجاحه، والاختبار الذي ينتظر التصحيح لا يُحتسب حتى يُعتمد
            </Txt>
          ) : null}

          {validationError ? (
            <Txt size={12} color={colors.stateDanger} style={{ marginTop: 10 }}>
              {validationError}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { marginTop: 16 } as ViewStyle,
  toggleRow: { flexDirection: 'row', alignItems: 'center' } as ViewStyle,
  conditions: {
    marginTop: 8,
    paddingTop: 4,
    paddingRight: 12,
    borderRightWidth: 2,
    borderRightColor: colors.borderHair,
  } as ViewStyle,
  label: { marginBottom: 8, marginTop: 16 } as ViewStyle,
  segmented: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.input,
    padding: 4,
  } as ViewStyle,
  segmentBtn: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  segmentBtnActive: { backgroundColor: colors.primaryTeal } as ViewStyle,
  pctRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 } as ViewStyle,
  pctInput: {
    width: 72,
    height: 42,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textInk,
  },
  presets: { flexDirection: 'row', gap: 6, marginRight: 8 } as ViewStyle,
  preset: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  presetActive: { backgroundColor: colors.primaryTeal, borderColor: colors.primaryTeal } as ViewStyle,
  quizList: {
    marginTop: 8,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 4,
  } as ViewStyle,
  quizRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 } as ViewStyle,
});
