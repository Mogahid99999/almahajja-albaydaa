import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radius } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { Txt } from '@/components/ui/Txt';

/**
 * «أضف إلى المراجعة لاحقًا» — the add-bookmark sheet (V20 · §4). Shows the lesson
 * title, the captured minute (frozen at open — the audio keeps playing, §4), and
 * an OPTIONAL short note. Saving without a note is fine. Same calm bottom-sheet
 * shell as GoalEditorSheet / RatingPromptModal; full RTL. It never touches the
 * player, so the sound never pauses.
 */
export function AddBookmarkSheet({
  visible,
  lessonTitle,
  positionSec,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  lessonTitle: string;
  positionSec: number;
  saving: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: 24 + insets.bottom,
            gap: 12,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.borderSand2,
            }}
          />

          <Txt weight="display" size={17} color={colors.primaryTeal} align="center">
            أضف إلى المراجعة لاحقًا
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center" numberOfLines={2}>
            {lessonTitle}
          </Txt>
          <Txt size={13} weight="semibold" color={colors.accentBrassMuted} align="center" tabular>
            {`الدقيقة ${arDuration(positionSec)}`}
          </Txt>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="ملاحظة قصيرة (اختياري)"
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            maxLength={500}
            style={{
              minHeight: 70,
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
            }}
          />

          <Pressable
            onPress={() => onSave(note.trim())}
            disabled={saving}
            accessibilityRole="button"
            style={({ pressed }) =>
              ({
                paddingVertical: 14,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.primaryTeal,
                opacity: pressed || saving ? 0.6 : 1,
              }) as ViewStyle
            }
          >
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ العلامة'}
            </Txt>
          </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
