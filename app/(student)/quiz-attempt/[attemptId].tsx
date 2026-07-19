/**
 * Quiz solver — /quiz-attempt/[attemptId] (PRD §12.3).
 *
 * One question at a time with its options, prev/next navigation, an answered
 * counter, answers saved as picked (server refuses saves past the deadline),
 * a confirmation sheet before the final submit, and — when the quiz is timed —
 * a calm countdown seeded from the SERVER's remaining seconds that auto-submits
 * at zero. Already-submitted attempts redirect straight to their result.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, View } from 'react-native';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Screen, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAttemptQuestions, useSaveAnswer, useSubmitAttempt } from '@/hooks/useQuizzes';
import { arabicOr } from '@/lib/errorText';
import { arDuration, arNum } from '@/lib/format';
import { useCelebrationStore } from '@/stores/celebrationStore';

const SAVE_WARNING_GENERIC = 'تعذّر حفظ الإجابة — تحقق من الاتصال، وسيُعاد الحفظ عند التسليم.';

export default function QuizAttemptScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const { data, isLoading, isError } = useAttemptQuestions(attemptId ?? '');
  const saveAnswer = useSaveAnswer();
  const submitAttempt = useSubmitAttempt();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // What the server has confirmed saved — resave any drift before submitting.
  const savedRef = useRef<Record<string, string>>({});
  const submittedRef = useRef(false);

  // Hold back any achievement celebration while the student is answering (§15
  // "لا يظهر قبل إعلان نتيجة الاختبار"). Cleared on unmount — leaving for the
  // result screen (or backing out) lets any queued celebration surface then.
  const setCelebrationSuppressed = useCelebrationStore((s) => s.setSuppressed);
  useEffect(() => {
    setCelebrationSuppressed(true);
    return () => setCelebrationSuppressed(false);
  }, [setCelebrationSuppressed]);

  // Wall-clock deadline (audit F-051): the countdown recomputes from this every
  // tick instead of decrementing a counter — RN timers freeze in background, so
  // a decrement silently under-counts time away and never reaches zero.
  const deadlineRef = useRef<number | null>(null);

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
    deadlineRef.current =
      data.remainingSec == null ? null : Date.now() + data.remainingSec * 1000;
    setRemaining(data.remainingSec);
  }, [data]);

  // Already submitted (reopened link) → straight to the result.
  useEffect(() => {
    if (data?.submittedAt && !submittedRef.current) {
      submittedRef.current = true;
      router.replace(`/quiz-result/${attemptId}` as Parameters<typeof router.replace>[0]);
    }
  }, [data?.submittedAt, attemptId, router]);

  // Calm countdown on the server's clock (seeded via deadlineRef), recomputed
  // from the wall clock every tick AND on foreground so time spent backgrounded
  // is accounted for — the old decrementing counter froze in background, showed
  // phantom time on return, and its zero (the auto-submit trigger) never fired
  // (audit F-051). Auto-submits at zero; a failed auto-submit retries on the
  // next tick (handleSubmit no-ops while pending/submitted).
  useEffect(() => {
    if (data?.remainingSec == null) return;
    const tick = () => {
      const dl = deadlineRef.current;
      if (dl == null) return;
      const r = Math.max(0, Math.ceil((dl - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0) void handleSubmit(true);
    };
    tick();
    const iv = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      clearInterval(iv);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.remainingSec]);

  const answeredCount = questions.filter((q) => answers[q.id]).length;
  const current = questions[index];

  function pickOption(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    saveAnswer.mutate(
      { attemptId: attemptId!, questionId, optionId },
      {
        onSuccess: () => {
          savedRef.current[questionId] = optionId;
          setSaveWarning(null);
        },
        // The server raises calm Arabic reasons («انتهى وقت الاختبار», «تم
        // تسليم هذه المحاولة») — show those verbatim; anything else (network,
        // English PostgREST noise) gets the generic connectivity line.
        onError: (err) => setSaveWarning(arabicOr(err, SAVE_WARNING_GENERIC)),
      },
    );
  }

  async function handleSubmit(auto = false) {
    if (submittedRef.current || submitAttempt.isPending || !attemptId) return;
    submittedRef.current = true;
    setConfirmOpen(false);
    setSubmitError(null);
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
      // Audit F-053: a failed submit was completely silent (the ref just reset)
      // — offline users thought they had submitted. Surface it and keep retry open.
      onError: (err) => {
        submittedRef.current = false;
        setSubmitError(arabicOr(err, 'تعذّر تسليم الاختبار — تحقق من الاتصال ثم أعد المحاولة.'));
      },
    });
  }

  // Audit F-052: a failed load (bad/foreign attempt id from a deep link, or a
  // network error on first open) used to spin forever — `!data` kept the
  // loading branch. Give it a calm exit.
  if (isError) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center">
            تعذّر فتح المحاولة
          </Txt>
          <Txt size={12.5} color={colors.textGhost} align="center">
            تحقق من الاتصال، أو عد إلى صفحة الاختبار وحاول من جديد.
          </Txt>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [
              {
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 28,
                borderRadius: radius.sm,
                borderWidth: 1.5,
                borderColor: colors.primaryTeal,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.primaryTeal}>
              العودة
            </Txt>
          </Pressable>
        </View>
      </Screen>
    );
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
          <Feather
            name={saveWarning === SAVE_WARNING_GENERIC ? 'wifi-off' : 'alert-circle'}
            size={14}
            color={colors.accentBrassMuted}
          />
          <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
            {saveWarning}
          </Txt>
        </View>
      ) : null}

      {submitError ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(184,92,74,0.09)',
            borderRadius: radius.sm,
            padding: 10,
            gap: 8,
            marginTop: 12,
          }}
        >
          <Feather name="alert-circle" size={14} color={colors.stateDanger} />
          <Txt size={12} color={colors.stateDanger} style={{ flex: 1 }}>
            {submitError}
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
