/**
 * ModeratorAnswerComposer — the shared answer UI for the sheikh (/sheikh) and
 * admin (/admin/questions) inboxes. An answer may be TEXT, a VOICE recording, or
 * BOTH:
 *   • Text: the existing multiline composer (unchanged behaviour).
 *   • Voice (native only): a «رد صوتي» toggle reveals the VoiceRecorder — record
 *     with pause/resume, preview, then send. On web the voice option is hidden
 *     and the moderator keeps the text answer.
 *
 * On إرسال: if a voice take exists it is uploaded to R2 first (uploadAnswerAudio),
 * then answer_question is called with the resulting key plus any typed text. At
 * least one of the two must be present (mirrors the SQL gate).
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { uploadAnswerAudio } from '@/api/questions';
import { type PickedFile } from '@/api/storage';
import { Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useAnswerQuestion } from '@/hooks/useQuestions';

import { VoiceRecorder } from './VoiceRecorder';

const CAN_RECORD = Platform.OS !== 'web';

export function ModeratorAnswerComposer({
  questionId,
  initialBody,
  onDone,
  onCancel,
}: {
  questionId: string;
  initialBody?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const answer = useAnswerQuestion();
  const [draft, setDraft] = useState(initialBody ?? '');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceFile, setVoiceFile] = useState<PickedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const busy = answer.isPending || uploading;
  const hasText = draft.trim().length > 0;
  const canSend = (hasText || !!voiceFile) && !busy;

  async function submit() {
    if (!canSend) return;
    setError('');
    try {
      let audioPath: string | undefined;
      if (voiceFile) {
        setUploading(true);
        audioPath = await uploadAnswerAudio(voiceFile);
        setUploading(false);
      }
      answer.mutate(
        { questionId, body: draft.trim() || undefined, audioPath },
        {
          onSuccess: () => onDone(),
          onError: (e) => setError(e instanceof Error ? e.message : 'تعذّر حفظ الجواب'),
        },
      );
    } catch (e) {
      setUploading(false);
      setError(e instanceof Error ? e.message : 'تعذّر رفع التسجيل الصوتي');
    }
  }

  return (
    <View style={{ marginTop: 12 }}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="اكتب الجواب هنا..."
        placeholderTextColor={colors.textGhost}
        multiline
        textAlign="right"
        textAlignVertical="top"
        style={styles.composer}
        autoFocus
      />

      {/* Voice-answer option — native only. */}
      {CAN_RECORD ? (
        voiceOpen ? (
          <VoiceRecorder
            onRecorded={setVoiceFile}
            onDiscard={() => {
              setVoiceFile(null);
              setVoiceOpen(false);
            }}
          />
        ) : (
          <Pressable
            onPress={() => setVoiceOpen(true)}
            style={({ pressed }) => [styles.voiceToggle, pressed && { opacity: 0.8 }]}
          >
            <Feather name="mic" size={14} color={colors.primaryTeal600} />
            <Txt size={12.5} weight="semibold" color={colors.primaryTeal600}>
              إضافة رد صوتي
            </Txt>
          </Pressable>
        )
      ) : null}

      {voiceFile ? (
        <View style={styles.voiceReady}>
          <Feather name="check-circle" size={13} color={colors.stateSuccess} />
          <Txt size={11.5} color={colors.stateSuccess}>
            التسجيل جاهز للإرسال
          </Txt>
        </View>
      ) : null}

      {error ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 6 }}>
          {error}
        </Txt>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={submit}
          disabled={!canSend}
          style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || !canSend ? 0.7 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onTealPrimary} />
          ) : (
            <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
              {voiceFile ? 'إرسال الإجابة الصوتية' : 'إرسال الجواب'}
            </Txt>
          )}
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
        >
          <Txt size={13} weight="medium" color={colors.textMuted}>
            إلغاء
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    minHeight: 96,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textInk,
  } as TextStyle,

  voiceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(44,97,87,0.08)',
  } as ViewStyle,

  voiceReady: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  } as ViewStyle,

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  } as ViewStyle,

  primaryBtn: {
    height: 42,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  ghostBtn: {
    height: 42,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
});
