/**
 * AnswerThread — the chronological answer list for one question (0086: a question
 * may carry many answers, added by any moderator). Each answer shows its author
 * name and its text and/or a VoiceNotePlayer. Falls back to the single mirrored
 * answer (answerBody / answerAudioPath) while the thread query is loading or when
 * it returns nothing, so there is never an empty gap.
 *
 * Calm, RTL, theme tokens only. Reused in both QuestionsBoard answer sites.
 */
import { useQuery } from '@tanstack/react-query';
import { View, type ViewStyle } from 'react-native';

import { getQuestionAnswers } from '@/api/questions';
import { queryKeys } from '@/constants/queryKeys';
import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';

import { VoiceNotePlayer } from './VoiceNotePlayer';

export function AnswerThread({
  questionId,
  fallbackBody,
  fallbackAudioPath,
}: {
  questionId: string;
  /** The mirrored latest answer (0084/0086) — shown until the thread loads. */
  fallbackBody?: string | null;
  fallbackAudioPath?: string | null;
}) {
  const { data: answers } = useQuery({
    queryKey: queryKeys.questionAnswers(questionId),
    queryFn: () => getQuestionAnswers(questionId),
  });

  // Until the thread resolves (or if it's empty), render the mirrored single
  // answer so there's never a blank while loading.
  if (!answers || answers.length === 0) {
    if (!fallbackBody && !fallbackAudioPath) return null;
    return (
      <View>
        {fallbackBody ? (
          <Txt size={13.5} color={colors.textSlate} style={{ lineHeight: 22 }}>
            {fallbackBody}
          </Txt>
        ) : null}
        {fallbackAudioPath ? (
          <View style={{ marginTop: fallbackBody ? 10 : 6 }}>
            <VoiceNotePlayer audioPath={fallbackAudioPath} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {answers.map((a, i) => (
        <View key={a.id} style={i > 0 ? styles.divided : undefined}>
          {answers.length > 1 ? (
            <Txt size={11.5} weight="semibold" color={colors.primaryTeal600} style={{ marginBottom: 6 }}>
              {a.answererName}
            </Txt>
          ) : null}
          {a.body ? (
            <Txt size={13.5} color={colors.textSlate} style={{ lineHeight: 22 }}>
              {a.body}
            </Txt>
          ) : null}
          {a.audioPath ? (
            <View style={{ marginTop: a.body ? 10 : 6 }}>
              <VoiceNotePlayer audioPath={a.audioPath} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = {
  divided: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSand2,
    paddingTop: 12,
  } as ViewStyle,
};
