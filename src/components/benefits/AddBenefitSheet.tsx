/**
 * «إضافة فائدة» — bottom sheet with two paths (Concept 1):
 *   فائدة من درس — pick the lesson (search, or the newest lessons), then write
 *   فائدة عامة   — write directly (not tied to a lesson)
 * Both publish anonymously through the existing gates (registered account,
 * length, blocked words) — no approval step.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SheetModal, Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { usePostBenefit } from '@/hooks/useBenefits';
import { useRecentLectures } from '@/hooks/useLecture';
import { useContentSearch } from '@/hooks/useSearch';
import { arabicOr } from '@/lib/errorText';

type Step = 'choose' | 'lesson' | 'compose';
type Lesson = { id: string; title: string; crumb: string | null };

function Option({ icon, title, sub, onPress, soft }: { icon: keyof typeof Feather.glyphMap; title: string; sub: string; onPress: () => void; soft?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.opt, pressed && { opacity: 0.85 }]}>
      <View style={[styles.optIc, soft ? { backgroundColor: colors.surfaceInset } : { backgroundColor: colors.primaryTeal }]}>
        <Feather name={icon} size={17} color={soft ? colors.primaryTeal : colors.onTealPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={14} weight="semibold" color={colors.textInk}>
          {title}
        </Txt>
        <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 2 }}>
          {sub}
        </Txt>
      </View>
      <Feather name="chevron-left" size={16} color={colors.textGhost} />
    </Pressable>
  );
}

function BackTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable onPress={onBack} accessibilityLabel="رجوع" hitSlop={8}>
        <Feather name="chevron-right" size={20} color={colors.primaryTeal} />
      </Pressable>
      <Txt size={17} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
        {title}
      </Txt>
    </View>
  );
}

function LessonPicker({ onPick }: { onPick: (l: Lesson) => void }) {
  const [q, setQ] = useState('');
  const search = useContentSearch(q.trim());
  const recent = useRecentLectures();
  const searching = q.trim().length >= 2;
  const list: Lesson[] = searching
    ? (search.data?.lectures ?? []).map((l) => ({ id: l.id, title: l.title, crumb: l.sectionTitle ?? null }))
    : (recent.data ?? []).map((l) => ({ id: l.id, title: l.title, crumb: null }));
  const loading = searching ? search.isLoading : recent.isLoading;
  return (
    <>
      <View style={styles.search}>
        <Feather name="search" size={15} color={colors.textGhost} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="ابحث باسم الدرس أو السلسلة"
          placeholderTextColor={colors.textGhost}
          style={styles.searchInput}
          textAlign="right"
          autoCorrect={false}
        />
      </View>
      <Txt size={11.5} color={colors.textGhost}>
        {searching ? 'نتائج البحث' : 'أحدث الدروس'}
      </Txt>
      <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
        {loading ? <ActivityIndicator color={colors.primaryTeal} style={{ marginVertical: 16 }} /> : null}
        {!loading && list.length === 0 ? (
          <Txt size={12.5} color={colors.textMuted} align="center" style={{ marginVertical: 16 }}>
            لا دروس مطابقة
          </Txt>
        ) : null}
        {list.map((l) => (
          <Pressable key={l.id} onPress={() => onPick(l)} style={({ pressed }) => [styles.opt, pressed && { opacity: 0.85 }]}>
            <View style={{ flex: 1 }}>
              {l.crumb ? (
                <Txt size={11} color={colors.textGhost} numberOfLines={1}>
                  {l.crumb}
                </Txt>
              ) : null}
              <Txt size={13} weight="semibold" color={colors.textInk} numberOfLines={2}>
                {l.title}
              </Txt>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

export function AddBenefitSheet({ visible, onClose, onPosted }: { visible: boolean; onClose: () => void; onPosted: () => void }) {
  const [step, setStep] = useState<Step>('choose');
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const post = usePostBenefit();

  function close() {
    onClose();
    setStep('choose');
    setLesson(null);
    setBody('');
    setError('');
  }

  function submit() {
    const text = body.trim();
    if (text.length < 3) {
      setError('اكتب الفائدة أولاً');
      return;
    }
    setError('');
    post.mutate(
      { lectureId: lesson?.id ?? null, body: text },
      {
        onSuccess: () => {
          close();
          onPosted();
        },
        onError: (e) => setError(arabicOr(e, 'تعذّر نشر الفائدة')),
      },
    );
  }

  return (
    <SheetModal visible={visible} onClose={close}>
      <Pressable onPress={() => {}} style={styles.sheet}>
        {step === 'choose' ? (
          <>
            <Txt size={17} weight="display" color={colors.primaryTeal}>
              إضافة فائدة
            </Txt>
            <Txt size={12} color={colors.textMuted}>
              تُنشر دون اسمك
            </Txt>
            <Option icon="headphones" title="فائدة من درس" sub="اختر الدرس الذي قيّدت منه الفائدة" onPress={() => setStep('lesson')} />
            <Option
              icon="feather"
              title="فائدة عامة"
              sub="من كتاب أو مجلس أو غيره"
              soft
              onPress={() => {
                setLesson(null);
                setStep('compose');
              }}
            />
          </>
        ) : step === 'lesson' ? (
          <>
            <BackTitle title="اختر الدرس" onBack={() => setStep('choose')} />
            <LessonPicker
              onPick={(l) => {
                setLesson(l);
                setStep('compose');
              }}
            />
          </>
        ) : (
          <>
            <BackTitle title={lesson ? 'فائدة من درس' : 'فائدة عامة'} onBack={() => setStep(lesson ? 'lesson' : 'choose')} />
            {lesson ? (
              <View style={styles.lessonTag}>
                <Feather name="headphones" size={13} color={colors.primaryTeal} />
                <Txt size={12} weight="semibold" color={colors.primaryTeal} numberOfLines={1} style={{ flex: 1 }}>
                  {lesson.title}
                </Txt>
              </View>
            ) : null}
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={lesson ? 'اكتب الفائدة هنا...' : 'اكتب الفائدة، ويحسن أن تنسبها إلى قائلها...'}
              placeholderTextColor={colors.textGhost}
              multiline
              maxLength={1000}
              textAlign="right"
              textAlignVertical="top"
              style={styles.input}
              accessibilityLabel="نص الفائدة"
            />
            <Txt size={11.5} color={colors.textGhost}>
              تُنشر دون اسمك
            </Txt>
            {error ? (
              <Txt size={12} color={colors.stateDanger}>
                {error}
              </Txt>
            ) : null}
            <Pressable
              onPress={submit}
              disabled={post.isPending}
              accessibilityRole="button"
              style={({ pressed }) => [styles.btn, (pressed || post.isPending) && { opacity: 0.85 }]}
            >
              {post.isPending ? (
                <ActivityIndicator color={colors.onTealPrimary} />
              ) : (
                <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
                  نشر الفائدة
                </Txt>
              )}
            </Pressable>
          </>
        )}
      </Pressable>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bgSandRaised,
    borderTopLeftRadius: radius.artwork,
    borderTopRightRadius: radius.artwork,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
    gap: 12,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  optIc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.textInk, paddingVertical: 9 },
  lessonTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceInset,
    borderRadius: radius.input,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  input: {
    minHeight: 120,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 24,
    color: colors.textInk,
  },
  btn: {
    backgroundColor: colors.primaryTeal,
    borderRadius: radius.input,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
