/**
 * Quiz solver — /quiz-attempt/[attemptId] (PRD §12.3).
 *
 * One question at a time with its options, prev/next navigation, an answered
 * counter, answers saved as picked (server refuses saves past the deadline),
 * a confirmation sheet before the final submit, and — when the quiz is timed —
 * a calm countdown seeded from the SERVER's remaining seconds that auto-submits
 * at zero. Already-submitted attempts redirect straight to their result.
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Screen, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAttemptQuestions, useSaveAnswer, useSubmitAttempt } from '@/hooks/useQuizzes';
import { arDuration, arNum } from '@/lib/format';

export default function QuizAttemptScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const { data, isLoading } = useAttemptQuestions(attemptId ?? '');
  const saveAnswer = useSaveAnswer();
  const submitAttempt = useSubmitAttempt();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saveWarning, setSaveWarning] = useState(false);
  // What the server has confirmed saved — resave any drift before submitting.
  const savedRef = useRef<Record<string, string>>({});
  const submittedRef = useRef(false);

  const questions = useMemo(() => data?.questions ?? [], [data]);

  // Seed local answers + saved map from the server payload (resume support).
  useEffect(() => {
    if (!data) return;
    const seeded: Record<string, string> = {};
    for (const q of data.questions) {
      if (q.selectedOptionId) seeded[q.id] = q.selectedOptionId;
    }
    setAnswers((prev) => ({ ...seeded, ...prev }));
    savedRef.current = { ...seeded, ...savedRef.current };
    setRemaining(data.remainingSec);
  }, [data]);

  // Already submitted (reopened link) → straight to the result.
  useEffect(() => {
    if (data?.submittedAt && !submittedRef.current) {
      submittedRef.current = true;
      router.replace(`/quiz-result/${attemptId}` as Parameters<typeof router.replace>[0]);
    }
  }, [data?.submittedAt, attemptId, router]);

  // Calm countdown on the server's clock; auto-submit at zero.
  useEffect(() => {
    if (remaining == null) return;
    if (remaining <= 0) {
      void handleSubmit(true);
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r == null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const answeredCount = questions.filter((q) => answers[q.id]).length;
  const current = questions[index];

  function pickOption(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    saveAnswer.mutate(
      { attemptId: attemptId!, questionId, optionId },
      {
        onSuccess: () => {
          savedRef.current[questionId] = optionId;
          setSaveWarning(false);
        },
        onError: () => setSaveWarning(true),
      },
    );
  }

  async function handleSubmit(auto = false) {
    if (submittedRef.current || !attemptId) return;
    submittedRef.current = true;
    setConfirmOpen(false);
    // Resave anything the server hasn't confirmed (drops silently if the
    // deadline passed — the server grades only in-time answers).
    if (!auto) {
      await Promise.all(
        Object.entries(answers)
          .filter(([qId, oId]) => savedRef.current[qId] !== oId)
          .map(([qId, oId]) =>
            saveAnswer
              .mutateAsync({ attemptId, questionId: qId, optionId: oId })
              .catch(() => undefined),
          ),
      );
    }
    submitAttempt.mutate(attemptId, {
      onSuccess: () =>
        router.replace(`/quiz-result/${attemptId}` as Parameters<typeof router.replace>[0]),
      onError: () => {
        submittedRef.current = false;
      },
    });
  }

  if (isLoading || !data) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  if (questions.length === 0) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center">
            لا توجد أسئلة في هذا الاختبار بعد
          </Txt>
        </View>
      </Screen>
    );
  }

  const isLast = index === questions.length - 1;

  return (
    <Screen scroll padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
      {/* Top bar: exit + progress + timer */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 6,
        }}
      >
        <Txt size={13} weight="semibold" color={colors.textSlate} tabular>
          {`السؤال ${arNum(index + 1)} من ${arNum(questions.length)}`}
        </Txt>
        {remaining != null ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: remaining <= 60 ? 'rgba(184,92,74,0.1)' : colors.bgSandRaised,
              borderRadius: radius.pill,
              paddingHorizontal: 12,
              paddingVertical: 5,
            }}
          >
            <Feather
              name="clock"
              size={13}
              color={remaining <= 60 ? colors.stateDanger : colors.textMuted}
            />
            <Txt
              size={13}
              weight="semibold"
              color={remaining <= 60 ? colors.stateDanger : colors.textSlate}
              tabular
            >
              {arDuration(remaining)}
            </Txt>
          </View>
        ) : null}
      </View>

      {/* Thin progress track */}
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.surfaceTrack,
          overflow: 'hidden',
          marginTop: 6,
        }}
      >
        <View
          style={{
            height: 4,
            borderRadius: 2,
            width: `${Math.round(((index + 1) / questions.length) * 100)}%`,
            backgroundColor: colors.primaryTeal,
            alignSelf: 'flex-end',
          }}
        />
      </View>

      {saveWarning ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(176,137,79,0.1)',
            borderRadius: radius.sm,
            padding: 10,
            gap: 8,
            marginTop: 12,
          }}
        >
          <Feather name="wifi-off" size={14} color={colors.accentBrassMuted} />
          <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
            تعذّر حفظ الإجابة — تحقق من الاتصال، وسيُعاد الحفظ عند التسليم.
          </Txt>
        </View>
      ) : null}

      {/* Question */}
      <Card style={{ marginTop: 18 }}>
        <Txt size={16} weight="semibold" color={colors.textInk} style={{ lineHeight: 28 }}>
          {current.text}
        </Txt>
      </Card>

      {/* Options */}
      <View style={{ marginTop: 14, gap: 10 }}>
        {current.options.map((option) => {
          const selected = answers[current.id] === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => pickOption(current.id, option.id)}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: selected ? 'rgba(31,74,66,0.07)' : colors.surfaceCard,
                  borderWidth: 1.5,
                  borderColor: selected ? colors.primaryTeal : colors.borderSand,
                  borderRadius: radius.card,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: selected ? colors.primaryTeal : colors.borderSand2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected ? (
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: colors.primaryTeal,
                    }}
                  />
                ) : null}
              </View>
              <Txt
                size={14}
                weight={selected ? 'semibold' : 'regular'}
                color={colors.textInk}
                style={{ flex: 1, lineHeight: 24 }}
              >
                {option.text}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {/* Answered counter */}
      <Txt size={12} color={colors.textGhost} align="center" style={{ marginTop: 16 }} tabular>
        {`أجبت عن ${arNum(answeredCount)} من ${arNum(questions.length)}`}
      </Txt>

      {/* Prev / Next / Submit */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Pressable
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          style={({ pressed }) => [
            {
              flex: 1,
              height: 48,
              borderRadius: radius.sm,
              borderWidth: 1.5,
              borderColor: index === 0 ? colors.borderSand : colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              opacity: pressed ? 0.7 : index === 0 ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
        >
          <Feather
            name="chevron-right"
            size={16}
            color={index === 0 ? colors.textGhost : colors.primaryTeal}
          />
          <Txt
            weight="semibold"
            size={14}
            color={index === 0 ? colors.textGhost : colors.primaryTeal}
          >
            السابق
          </Txt>
        </Pressable>

        {isLast ? (
          <Pressable
            onPress={() => setConfirmOpen(true)}
            disabled={submitAttempt.isPending}
            style={({ pressed }) => [
              {
                flex: 1,
                height: 48,
                borderRadius: radius.sm,
                backgroundColor: colors.primaryTeal,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || submitAttempt.isPending ? 0.85 : 1,
                ...shadows.button,
              },
            ]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {submitAttempt.isPending ? 'جارٍ التسليم...' : 'تسليم الاختبار'}
            </Txt>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            style={({ pressed }) => [
              {
                flex: 1,
                height: 48,
                borderRadius: radius.sm,
                backgroundColor: colors.primaryTeal,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                opacity: pressed ? 0.85 : 1,
                ...shadows.button,
              },
            ]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              التالي
            </Txt>
            <Feather name="chevron-left" size={16} color={colors.onTealPrimary} />
          </Pressable>
        )}
      </View>

      {/* Early submit affordance (visible before the last question too) */}
      {!isLast ? (
        <Pressable
          onPress={() => setConfirmOpen(true)}
          style={({ pressed }) => [{ alignSelf: 'center', marginTop: 16, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
        >
          <Txt size={13} weight="semibold" color={colors.accentBrassMuted}>
            تسليم الاختبار
          </Txt>
        </Pressable>
      ) : null}

      {/* Confirmation sheet */}
      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(22,53,47,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 28,
          }}
        >
          <Card style={{ width: '100%', maxWidth: 380, gap: 6 }}>
            <Txt weight="semibold" size={16} color={colors.textInk} align="center">
              هل أنت متأكد من تسليم إجاباتك؟
            </Txt>
            {answeredCount < questions.length ? (
              <Txt size={13} color={colors.textMuted} align="center" style={{ marginTop: 4 }}>
                {`بقي ${arNum(questions.length - answeredCount)} من الأسئلة بدون إجابة.`}
              </Txt>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => void handleSubmit()}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    height: 46,
                    borderRadius: radius.sm,
                    backgroundColor: colors.primaryTeal,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                accessibilityRole="button"
              >
                <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                  تسليم
                </Txt>
              </Pressable>
              <Pressable
                onPress={() => setConfirmOpen(false)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    height: 46,
                    borderRadius: radius.sm,
                    borderWidth: 1.5,
                    borderColor: colors.borderSand2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                accessibilityRole="button"
              >
                <Txt weight="semibold" size={14} color={colors.textMuted}>
                  متابعة الحل
                </Txt>
              </Pressable>
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
