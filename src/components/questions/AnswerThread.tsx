/**
 * AnswerThread — the chronological answer list for one question (0086: a question
 * may carry many answers, added by any moderator). Each answer shows its author
 * name and its text and/or a VoiceNotePlayer. Falls back to the single mirrored
 * answer (answerBody / answerAudioPath) while the thread query is loading or when
 * it returns nothing, so there is never an empty gap.
 *
 * When `reportable` is set, each answer gets an «الإبلاغ عن خطأ في الإجابة»
 * action (item 4) — the report reaches the admin panel AND the answering sheikh
 * (0095 report_content 'answer'). The thread owns its own ReportSheet so callers
 * don't have to thread report state through. Only enable it on the student-facing
 * public view — never inside the admin/sheikh inbox (they don't report answers).
 *
 * Calm, RTL, theme tokens only. Reused in both QuestionsBoard answer sites.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { getQuestionAnswers } from '@/api/questions';
import { queryKeys } from '@/constants/queryKeys';
import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { ReportSheet } from '@/components/reports/ReportSheet';
import { useReportContent } from '@/hooks/useReports';

import { VoiceNotePlayer } from './VoiceNotePlayer';

export function AnswerThread({
  questionId,
  fallbackBody,
  fallbackAudioPath,
  reportable = false,
}: {
  questionId: string;
  /** The mirrored latest answer (0084/0086) — shown until the thread loads. */
  fallbackBody?: string | null;
  fallbackAudioPath?: string | null;
  /** Show the «الإبلاغ عن خطأ في الإجابة» action per answer (student view only). */
  reportable?: boolean;
}) {
  const { data: answers } = useQuery({
    queryKey: queryKeys.questionAnswers(questionId),
    queryFn: () => getQuestionAnswers(questionId),
  });

  // The answer id currently being reported (drives the shared ReportSheet).
  const [reportAnswerId, setReportAnswerId] = useState<string | null>(null);
  const report = useReportContent();

  const reportSheet = reportable ? (
    <ReportSheet
      visible={!!reportAnswerId}
      pending={report.isPending}
      error={report.error instanceof Error ? report.error.message : undefined}
      onClose={() => setReportAnswerId(null)}
      onSubmit={(reason) => {
        if (!reportAnswerId) return;
        report.mutate(
          { contentType: 'answer', contentId: reportAnswerId, reason: reason || undefined },
          { onSuccess: () => setReportAnswerId(null) },
        );
      }}
    />
  ) : null;

  // Until the thread resolves (or if it's empty), render the mirrored single
  // answer so there's never a blank while loading. (Answer-reporting needs the
  // real question_answers id, so the fallback path is not itself reportable.)
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
          {reportable ? (
            <Pressable
              onPress={() => setReportAnswerId(a.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="الإبلاغ عن خطأ في الإجابة"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                alignSelf: 'flex-start',
                marginTop: 10,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="flag" size={12} color={colors.textGhost} />
              <Txt size={11.5} weight="medium" color={colors.textGhost}>
                الإبلاغ عن خطأ في الإجابة
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ))}
      {reportSheet}
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
