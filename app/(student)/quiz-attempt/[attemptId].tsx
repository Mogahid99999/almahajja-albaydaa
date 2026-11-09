/**
 * Quiz solver — /quiz-attempt/[attemptId] (PRD §12.3).
 *
 * One question at a time, prev/next, an answered counter and a confirmation
 * before the final submit. 0166: written questions show a multiline field.
 *
 * 0174: the attempt lives on the device (useQuizSession), so it can be finished
 * with no connection. The countdown cannot be reset by leaving or reopening, and
 * at zero the attempt locks and is delivered now or when the connection returns.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, TextInput, View } from 'react-native';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useQuizSession } from '@/hooks/useQuizSession';
import { arCountdown, arNum } from '@/lib/format';
import { useCelebrationStore } from '@/stores/celebrationStore';

/** Calm notice for the last five minutes; a clearer state for the last one. */
const CALM_WARNING_SEC = 300;
const URGENT_WARNING_SEC = 60;

function lockedMessage(reason: 'timeout' | 'manual' | null, online: boolean, failed: boolean): string {
  if (!online) {
    return reason === 'timeout'
      ? 'انتهى وقت الاختبار، وسيتم إرسال إجاباتك تلقائيًا عند عودة الاتصال.'
      : 'تم حفظ إجاباتك، وسيتم إرسالها تلقائيًا عند عودة الاتصال.';
  }
  if (failed) return 'تعذّر إرسال إجاباتك الآن، وهي محفوظة وسيُعاد إرسالها تلقائيًا.';
  return reason === 'timeout' ? 'انتهى وقت الاختبار، جارٍ تسليم إجاباتك...' : 'جارٍ تسليم إجاباتك...';
}

export default function QuizAttemptScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const {
    status,
    questions,
    options: answers,
    texts,
    remaining,
    finishReason,
    saveWarning,
    syncFailed,
    online,
    pickOption,
    changeText,
    flushDrafts,
    submit,
    retrySync,
  } = useQuizSession(attemptId ?? '');

  const [index, setIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const redirectedRef = useRef(false);

  // Hold back any achievement celebration while the student is answering (§15
  // "لا يظهر قبل إعلان نتيجة الاختبار"). Cleared on unmount — leaving for the
  // result screen (or backing out) lets any queued celebration surface then.
  const setCelebrationSuppressed = useCelebrationStore((s) => s.setSuppressed);
  useEffect(() => {
    setCelebrationSuppressed(true);
    return () => setCelebrationSuppressed(false);
  }, [setCelebrationSuppressed]);

  useEffect(() => {
    if (status === 'submitted' && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace(`/quiz-result/${attemptId}` as Parameters<typeof router.replace>[0]);
    }
  }, [status, attemptId, router]);

  useEffect(() => {
    if (status === 'locked') setConfirmOpen(false);
  }, [status]);

  const isAnswered = (q: (typeof questions)[number]) =>
    q.kind === 'text' ? (texts[q.id] ?? '').trim().length > 0 : !!answers[q.id];
  const answeredCount = questions.filter(isAnswered).length;
  const current = questions[index];

  function goTo(next: number) {
    flushDrafts();
    setIndex(next);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const handleSubmit = () => {
    setConfirmOpen(false);
    void submit();
  };

  // Audit F-052: a failed load must never spin forever.
  if (status === 'error') {
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
            onPress={goBack}
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

  if (status === 'loading' || status === 'submitted') {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  // The attempt is over: no question is reachable from here.
  if (status === 'locked') {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Feather name={online ? 'clock' : 'wifi-off'} size={26} color={colors.accentBrassMuted} />
          {finishReason === 'timeout' ? (
            <Txt size={22} weight="semibold" color={colors.textSlate} tabular>
              {arCountdown(0)}
            </Txt>
          ) : null}
          <Txt
            size={15}
            weight="semibold"
            color={colors.textMuted}
            align="center"
            style={{ alignSelf: 'stretch', lineHeight: 26 }}
          >
            {lockedMessage(finishReason, online, syncFailed)}
          </Txt>
          {online && syncFailed ? (
            <Pressable
              onPress={() => void retrySync()}
              style={({ pressed }) => ({
                paddingVertical: 12,
                paddingHorizontal: 28,
                borderRadius: radius.sm,
                backgroundColor: colors.primaryTeal,
                opacity: pressed ? 0.85 : 1,
              })}
              accessibilityRole="button"
            >
              <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                إعادة الإرسال
              </Txt>
            </Pressable>
          ) : null}
          <Pressable onPress={goBack} style={{ padding: 8 }} accessibilityRole="button">
            <Txt size={13} weight="semibold" color={colors.primaryTeal}>
              العودة
            </Txt>
          </Pressable>
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
  const isTextQuestion = current.kind === 'text';
  const urgent = remaining != null && remaining <= URGENT_WARNING_SEC;
  const calm = remaining != null && !urgent && remaining <= CALM_WARNING_SEC;

  return (
    <Screen
      scroll
      padded
      bottomPad={40 + BOTTOM_NAV_CLEARANCE}
      keyboardAvoiding
      keyboardShouldPersistTaps="handled"
    >
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
              backgroundColor: urgent
                ? 'rgba(184,92,74,0.14)'
                : calm
                  ? 'rgba(176,137,79,0.12)'
                  : colors.bgSandRaised,
              borderWidth: urgent ? 1 : 0,
              borderColor: colors.stateDanger,
              borderRadius: radius.pill,
              paddingHorizontal: 12,
              paddingVertical: 5,
            }}
            accessibilityLabel="الوقت المتبقي"
          >
            <Feather
              name="clock"
              size={13}
              color={urgent ? colors.stateDanger : calm ? colors.accentBrassMuted : colors.textMuted}
            />
            <Txt
              size={urgent ? 15 : 13}
              weight="semibold"
              color={urgent ? colors.stateDanger : calm ? colors.accentBrassMuted : colors.textSlate}
              tabular
            >
              {arCountdown(remaining)}
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
            name="alert-circle"
            size={14}
            color={colors.accentBrassMuted}
          />
          <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
            {saveWarning}
          </Txt>
        </View>
      ) : null}

      {/* Question */}
      <Card style={{ marginTop: 18 }}>
        <Txt size={16} weight="semibold" color={colors.textInk} style={{ lineHeight: 28 }}>
          {current.text}
        </Txt>
      </Card>

      {/* Written answer (0166) */}
      {isTextQuestion ? (
        <View style={{ marginTop: 14 }}>
          <TextInput
            key={current.id}
            value={texts[current.id] ?? ''}
            onChangeText={(t) => changeText(current.id, t)}
            onBlur={flushDrafts}
            placeholder="اكتب إجابتك هنا..."
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            maxLength={8000}
            accessibilityLabel="إجابتك"
            style={{
              minHeight: 170,
              maxHeight: 360,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1.5,
              borderColor: (texts[current.id] ?? '').trim() ? colors.primaryTeal : colors.borderSand,
              borderRadius: radius.card,
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 14,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 26,
              color: colors.textInk,
              writingDirection: 'rtl',
            }}
          />
          <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 6 }}>
            تُحفظ إجابتك تلقائيًا أثناء الكتابة.
          </Txt>
        </View>
      ) : null}

      {/* Options */}
      <View style={{ marginTop: 14, gap: 10 }}>
        {(isTextQuestion ? [] : current.options).map((option) => {
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
          onPress={() => goTo(Math.max(0, index - 1))}
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
                        style={({ pressed }) => [
              {
                flex: 1,
                height: 48,
                borderRadius: radius.sm,
                backgroundColor: colors.primaryTeal,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
                ...shadows.button,
              },
            ]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary} align="center" style={{ alignSelf: 'stretch' }}>
              تسليم الاختبار
            </Txt>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => goTo(Math.min(questions.length - 1, index + 1))}
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
          // Stretched + centered: a content-sized RTL Text clipped to «تسليم» on
          // Android after a re-render (seen on R5CX10P3BPL).
          style={({ pressed }) => [{ alignSelf: 'stretch', marginTop: 16, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
        >
          <Txt size={13} weight="semibold" color={colors.accentBrassMuted} align="center">
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
                onPress={handleSubmit}
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
