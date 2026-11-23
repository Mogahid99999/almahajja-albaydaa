/**
 * «مشاركة» on an answered question (owner 2026-11-23): the system share sheet —
 * copy, WhatsApp (the text lands in the chosen chat's message box), any app.
 *
 * Who sees it is decided by where it is placed: the public answered lists
 * (everyone) and the asker's own questions («أسئلتي», public or private) —
 * never the moderators' inbox. Hidden when no answer has text (voice only).
 * Reads the same answer-thread cache as AnswerThread; until it loads, the
 * mirrored latest answer stands in.
 */
import Feather from '@expo/vector-icons/Feather';
import { Pressable, Share } from 'react-native';

import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { useQuestionAnswers } from '@/hooks/useQuestions';
import { questionShareText } from '@/lib/questionShare';

export function ShareAnswerButton({
  questionId,
  questionBody,
  fallbackBody,
}: {
  questionId: string;
  questionBody: string;
  fallbackBody?: string | null;
}) {
  const { data: answers } = useQuestionAnswers(questionId);
  const bodies = answers && answers.length > 0 ? answers.map((a) => a.body) : [fallbackBody];
  const text = questionShareText(questionBody, bodies);
  if (!text) return null;

  return (
    <Pressable
      onPress={() => {
        Share.share({ message: text }, { dialogTitle: 'مشاركة السؤال والجواب' }).catch(() => undefined);
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="مشاركة السؤال والجواب"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginStart: 'auto',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="share-2" size={13} color={colors.primaryTeal600} />
      <Txt size={11.5} weight="medium" color={colors.primaryTeal600}>
        مشاركة
      </Txt>
    </Pressable>
  );
}
