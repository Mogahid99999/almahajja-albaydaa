/**
 * Quiz result — /quiz-result/[attemptId] (PRD §12.3).
 *
 * Respects the admin's visibility switches: with show_result off only a calm
 * "received" note appears (no score); correct-answer detail renders only when
 * show_correct_answers is on. Personal results only — never compared (§12.6).
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Card, Divider, Screen, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAttemptResult } from '@/hooks/useQuizzes';
import { arNum } from '@/lib/format';

export default function QuizResultScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const { data: result, isLoading } = useAttemptResult(attemptId ?? '');

  if (isLoading || !result) {
    return (
      <Screen scroll={false} padded bottomPad={40}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  const passed = result.passed === true;

  return (
    <Screen scroll padded bottomPad={40}>
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

        <Txt weight="display" size={22} color={colors.primaryTeal} align="center">
          {result.quizTitle}
        </Txt>

        {result.showResult ? (
          <>
            <Txt
              weight="semibold"
              size={15}
              color={passed ? colors.stateSuccess : colors.stateDanger}
              align="center"
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

          <Divider />

          <View style={{ flexDirection: 'row-reverse', paddingTop: 14 }}>
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
        </Card>
      ) : null}

      {/* Correct answers detail (admin-enabled only) */}
      {result.showCorrectAnswers && result.details ? (
        <View style={{ marginTop: 24 }}>
          <Txt weight="semibold" size={16} color={colors.textInk} style={{ marginBottom: 12 }}>
            مراجعة الإجابات
          </Txt>
          <View style={{ gap: 12 }}>
            {result.details.map((d, i) => (
              <Card key={d.questionId}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 }}>
                  <Feather
                    name={d.isCorrect ? 'check-circle' : 'x-circle'}
                    size={17}
                    color={d.isCorrect ? colors.stateSuccess : colors.stateDanger}
                    style={{ marginTop: 3 }}
                  />
                  <View style={{ flex: 1, gap: 8 }}>
                    <Txt size={14} weight="semibold" color={colors.textInk} style={{ lineHeight: 24 }}>
                      {`${arNum(i + 1)}. ${d.text}`}
                    </Txt>
                    <Txt size={12.5} color={d.isCorrect ? colors.stateSuccess : colors.stateDanger}>
                      {d.selectedOptionText ? `إجابتك: ${d.selectedOptionText}` : 'لم تُجب عن هذا السؤال'}
                    </Txt>
                    {!d.isCorrect && d.correctOptionText ? (
                      <Txt size={12.5} color={colors.stateSuccess}>
                        {`الإجابة الصحيحة: ${d.correctOptionText}`}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              </Card>
            ))}
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
