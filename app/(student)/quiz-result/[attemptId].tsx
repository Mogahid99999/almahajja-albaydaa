/**
 * Quiz result — /quiz-result/[attemptId] (PRD §12.3).
 *
 * Respects the admin's visibility switches: with show_result off only a calm
 * "received" note appears (no score); correct-answer detail renders only when
 * show_correct_answers is on. Personal results only — never compared (§12.6).
 *
 * 0166: a quiz with written questions shows «بانتظار التصحيح» (no score, no
 * pass/fail, no review) until a grader approves it; once graded the summary is
 * the score + pass line only (a written question earns points, not ✓/✕), and
 * the review cards show the written answer, its grade, the grader's note and —
 * with «إظهار الإجابات الصحيحة» — the model answer. MCQ-only quizzes are unchanged.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Divider, Screen, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAttemptResult } from '@/hooks/useQuizzes';
import type { QuizResultDetail } from '@/api/types';
import { arNum } from '@/lib/format';

/** One written question in «مراجعة الإجابات» (0166) — same card language. */
function WrittenReviewCard({ index, detail: d }: { index: number; detail: QuizResultDetail }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Feather name="edit-3" size={16} color={colors.primaryTeal} style={{ marginTop: 4 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <Txt size={14} weight="semibold" color={colors.textInk} style={{ lineHeight: 24 }}>
            {`${arNum(index + 1)}. ${d.text}`}
          </Txt>
          <View style={{ gap: 3 }}>
            <Txt size={12} weight="semibold" color={colors.textMuted}>
              إجابتك
            </Txt>
            <Txt size={13.5} color={colors.textInk} style={{ lineHeight: 24 }}>
              {d.textAnswer ? d.textAnswer : 'لم تكتب إجابة لهذا السؤال'}
            </Txt>
          </View>
          {d.awardedPoints != null ? (
            <Txt size={13} weight="semibold" color={colors.primaryTeal} tabular>
              {`الدرجة: ${arNum(d.awardedPoints)} / ${arNum(d.points)}`}
            </Txt>
          ) : null}
          {d.graderNote ? (
            <View
              style={{
                backgroundColor: colors.bgSandRaised,
                borderRadius: radius.sm,
                padding: 10,
                gap: 3,
              }}
            >
              <Txt size={12} weight="semibold" color={colors.accentBrassMuted}>
                ملاحظة المصحح
              </Txt>
              <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22 }}>
                {d.graderNote}
              </Txt>
            </View>
          ) : null}
          {d.modelAnswer ? (
            <View style={{ gap: 3 }}>
              <Txt size={12} weight="semibold" color={colors.stateSuccess}>
                الإجابة النموذجية
              </Txt>
              <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22 }}>
                {d.modelAnswer}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

export default function QuizResultScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const { data: result, isLoading, isError } = useAttemptResult(attemptId ?? '');

  // Audit F-052: a failed load (bad/foreign attempt id, not-yet-submitted
  // attempt via deep link, or a network error) used to spin forever.
  if (isError) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center">
            تعذّر عرض النتيجة
          </Txt>
          <Txt size={12.5} color={colors.textGhost} align="center">
            تحقق من الاتصال ثم حاول مرة أخرى.
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

  if (isLoading || !result) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  const passed = result.passed === true;
  const pending = result.gradingStatus === 'pending';
  const hasWritten = result.hasWritten === true;

  if (pending) {
    return (
      <Screen scroll padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <View style={{ alignItems: 'center', marginTop: 30, gap: 12 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: 'rgba(176,137,79,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="clock" size={30} color={colors.accentBrassMuted} />
          </View>
          <Txt
            weight="display"
            size={22}
            color={colors.primaryTeal}
            align="center"
            style={{ alignSelf: 'stretch' }}
          >
            {result.quizTitle}
          </Txt>
          <View
            style={{
              backgroundColor: 'rgba(176,137,79,0.12)',
              borderRadius: radius.pill,
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Txt size={12} weight="semibold" color={colors.accentBrassMuted}>
              بانتظار التصحيح
            </Txt>
          </View>
        </View>

        <Card
          style={{
            marginTop: 24,
            gap: 8,
            alignItems: 'center',
            paddingVertical: 22,
          }}
        >
          {/* The ✓ glyph reads like «٧» in the Arabic UI font — a drawn check instead. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt weight="semibold" size={16} color={colors.stateSuccess}>
              تم تسليم الاختبار بنجاح
            </Txt>
            <Feather name="check" size={18} color={colors.stateSuccess} />
          </View>
          <Txt
            size={13.5}
            color={colors.textMuted}
            align="center"
            style={{ lineHeight: 24, alignSelf: 'stretch' }}
          >
            إجاباتك النصية بانتظار التصحيح، وستظهر نتيجتك بعد اكتمال التصحيح بإذن الله.
          </Txt>
        </Card>

        <View style={{ marginTop: 28 }}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [
              {
                height: 46,
                borderRadius: radius.sm,
                borderWidth: 1.5,
                borderColor: colors.primaryTeal,
                alignItems: 'center',
                justifyContent: 'center',
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

  return (
    <Screen scroll padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
      {/* Header */}
      <View style={{ alignItems: 'center', marginTop: 30, gap: 12 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: result.showResult
              ? passed
                ? 'rgba(31,138,91,0.12)'
                : 'rgba(184,92,74,0.1)'
              : colors.bgSandRaised,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather
            name={result.showResult ? (passed ? 'check' : 'rotate-ccw') : 'inbox'}
            size={30}
            color={
              result.showResult
                ? passed
                  ? colors.stateSuccess
                  : colors.stateDanger
                : colors.accentBrassMuted
            }
          />
        </View>

        {/* alignSelf:'stretch': content-sized RTL Text with align center clips
            its trailing word on Android (see player titleBlock). */}
        <Txt
          weight="display"
          size={22}
          color={colors.primaryTeal}
          align="center"
          style={{ alignSelf: 'stretch' }}
        >
          {result.quizTitle}
        </Txt>

        {result.showResult ? (
          <>
            <Txt
              weight="semibold"
              size={15}
              color={passed ? colors.stateSuccess : colors.stateDanger}
              align="center"
              // Content-sized centered RTL Text clips its trailing word on
              // Android («اجتزت الاختبار» showed as «اجتزت») — stretch it.
              style={{ alignSelf: 'stretch' }}
            >
              {passed ? 'اجتزت الاختبار' : 'لم تجتز الاختبار'}
            </Txt>
            <Txt size={13.5} color={colors.textMuted} align="center" style={{ lineHeight: 24 }}>
              {passed ? 'نفعك الله بما تعلمت.' : 'أعد المحاولة، ونسأل الله لك التوفيق.'}
            </Txt>
          </>
        ) : (
          <Txt size={13.5} color={colors.textMuted} align="center" style={{ lineHeight: 24 }}>
            تم استلام إجاباتك، نفع الله بك.
          </Txt>
        )}
      </View>

      {/* Score card */}
      {result.showResult ? (
        <Card style={{ marginTop: 24 }}>
          <View style={{ alignItems: 'center', paddingVertical: 8, gap: 4 }}>
            <Txt size={12.5} color={colors.textMuted}>
              درجتك
            </Txt>
            <Txt weight="display" size={34} color={colors.primaryTeal} tabular>
              {`${arNum(result.score ?? 0)} من ${arNum(result.totalScore ?? 0)}`}
            </Txt>
            <Txt size={12} color={colors.textGhost} tabular>
              {`درجة النجاح: ${arNum(result.passScore ?? 0)}`}
            </Txt>
          </View>

          {/* Right/wrong counts summarise an MCQ-only quiz; a written question
              earns points, not ✓/✕, so a mixed quiz shows the score only. */}
          {hasWritten ? null : (
            <>
              <Divider />

              <View style={{ flexDirection: 'row', paddingTop: 14 }}>
                <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
                  <Txt weight="semibold" size={18} color={colors.stateSuccess} tabular>
                    {arNum(result.correctCount ?? 0)}
                  </Txt>
                  <Txt size={12} color={colors.textMuted}>
                    إجابات صحيحة
                  </Txt>
                </View>
                <View style={{ width: 1, backgroundColor: colors.borderHair }} />
                <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
                  <Txt weight="semibold" size={18} color={colors.stateDanger} tabular>
                    {arNum(result.wrongCount ?? 0)}
                  </Txt>
                  <Txt size={12} color={colors.textMuted}>
                    إجابات خاطئة
                  </Txt>
                </View>
              </View>
            </>
          )}
        </Card>
      ) : null}

      {/* Answer review: MCQ rows only when the admin enabled correct answers;
          written rows of a graded quiz always (the server decides — 0166). */}
      {result.details && result.details.length > 0 ? (
        <View style={{ marginTop: 24 }}>
          <Txt weight="semibold" size={16} color={colors.textInk} style={{ marginBottom: 12 }}>
            مراجعة الإجابات
          </Txt>
          <View style={{ gap: 12 }}>
            {result.details.map((d, i) =>
              d.kind === 'text' ? (
                <WrittenReviewCard key={d.questionId} index={i} detail={d} />
              ) : (
                <Card key={d.questionId}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                  >
                    <Feather
                      name={d.isCorrect ? 'check-circle' : 'x-circle'}
                      size={17}
                      color={d.isCorrect ? colors.stateSuccess : colors.stateDanger}
                      style={{ marginTop: 3 }}
                    />
                    <View style={{ flex: 1, gap: 8 }}>
                      <Txt
                        size={14}
                        weight="semibold"
                        color={colors.textInk}
                        style={{ lineHeight: 24 }}
                      >
                        {`${arNum(i + 1)}. ${d.text}`}
                      </Txt>
                      <Txt
                        size={12.5}
                        color={d.isCorrect ? colors.stateSuccess : colors.stateDanger}
                      >
                        {d.selectedOptionText
                          ? `إجابتك: ${d.selectedOptionText}`
                          : 'لم تُجب عن هذا السؤال'}
                      </Txt>
                      {!d.isCorrect && d.correctOptionText ? (
                        <Txt size={12.5} color={colors.stateSuccess}>
                          {`الإجابة الصحيحة: ${d.correctOptionText}`}
                        </Txt>
                      ) : null}
                    </View>
                  </View>
                </Card>
              ),
            )}
          </View>
        </View>
      ) : null}

      {/* Actions */}
      <View style={{ marginTop: 28, gap: 12 }}>
        {result.canRetry ? (
          <Pressable
            onPress={() =>
              router.replace(`/quiz/${result.quizId}` as Parameters<typeof router.replace>[0])
            }
            style={({ pressed }) => [
              {
                height: 50,
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
            <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
              إعادة المحاولة
            </Txt>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => [
            {
              height: 46,
              borderRadius: radius.sm,
              borderWidth: 1.5,
              borderColor: colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
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
