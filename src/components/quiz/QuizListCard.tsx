/**
 * "اختبار هذا القسم" block — rendered on the section page below the lectures
 * and above the attachments (PRD §12.2). One clear standalone card per section
 * node; renders nothing when the node has no published quizzes.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { QuizCard } from '@/api/types';
import { Card, Divider, Rhombus, SectionTitle, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { arMinuteCount, arNum, arQuestionCount } from '@/lib/format';
import { QuizStatusPill } from './QuizStatusPill';

function QuizRow({ quiz }: { quiz: QuizCard }) {
  const router = useRouter();

  const meta = [
    arQuestionCount(quiz.questionCount),
    `النجاح: ${arNum(quiz.passScore)} من ${arNum(quiz.totalScore)}`,
    quiz.timeLimitSec ? arMinuteCount(Math.round(quiz.timeLimitSec / 60)) : null,
    quiz.maxAttempts != null
      ? `المحاولات المتبقية: ${arNum(quiz.attemptsLeft ?? 0)} من ${arNum(quiz.maxAttempts)}`
      : null,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={() => router.push(`/quiz/${quiz.id}` as Parameters<typeof router.push>[0])}
      style={({ pressed }) => [
        {
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
        },
        pressed && { backgroundColor: colors.bgSandRaised },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`اختبار: ${quiz.title}`}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.sm,
          backgroundColor: colors.bgSandRaised,
          borderWidth: 1,
          borderColor: colors.borderSand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="check-square" size={18} color={colors.primaryTeal} />
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
          <Txt
            size={14}
            weight="semibold"
            color={colors.textInk}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {quiz.title}
          </Txt>
          <QuizStatusPill status={quiz.status} />
        </View>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Rhombus size={6} color={colors.accentBrassMuted} />
          <Txt size={11.5} color={colors.textMuted} tabular>
            {meta.join(' · ')}
          </Txt>
        </View>
      </View>

      <Feather name="chevron-left" size={17} color={colors.textGhost} />
    </Pressable>
  );
}

export function QuizListCard({
  quizzes,
  isChildNode,
}: {
  quizzes: QuizCard[];
  /** true when this section is a child node (عنصر داخلي) — changes the title. */
  isChildNode: boolean;
}) {
  if (quizzes.length === 0) return null;

  return (
    <View>
      <SectionTitle title={isChildNode ? 'اختبار هذا العنصر' : 'اختبار هذا القسم'} />
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {quizzes.map((quiz, index) => (
          <View key={quiz.id}>
            {index > 0 ? <Divider /> : null}
            <QuizRow quiz={quiz} />
          </View>
        ))}
      </Card>
    </View>
  );
}
