import { useEffect, useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { colors, fonts, radius } from '@/constants/theme';

/**
 * Bottom-sheet «الإبلاغ عن هذا المحتوى» — shared by QuestionsBoard (public +
 * mine cards) and BenefitCard. An optional free-text reason; the reason itself
 * runs through the same blocked-word filter as everything else (0053) — a
 * rejection surfaces via `error`.
 */
export function ReportSheet({
  visible,
  pending = false,
  error,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
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
            paddingBottom: 34,
            gap: 14,
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

          <Txt weight="display" size={18} color={colors.primaryTeal} align="center">
            الإبلاغ عن هذا المحتوى
          </Txt>
          <Txt size={12.5} color={colors.textMuted} align="center" style={{ lineHeight: 20 }}>
            سيصل بلاغك إلى الإدارة للمراجعة. ذكر السبب اختياري.
          </Txt>

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="سبب البلاغ (اختياري)"
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            style={{
              minHeight: 72,
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

          {error ? (
            <Txt size={12.5} color={colors.stateDanger} align="center">
              {error}
            </Txt>
          ) : null}

          <Pressable
            onPress={() => onSubmit(reason.trim())}
            disabled={pending}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 4,
              paddingVertical: 14,
              borderRadius: radius.input,
              alignItems: 'center',
              backgroundColor: colors.stateDanger,
              opacity: pressed || pending ? 0.7 : 1,
            })}
          >
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              {pending ? 'جارٍ الإرسال…' : 'إرسال البلاغ'}
            </Txt>
          </Pressable>
          <Pressable onPress={onClose} disabled={pending} style={{ alignItems: 'center', paddingVertical: 6 }}>
            <Txt size={13} weight="medium" color={colors.textMuted}>
              إلغاء
            </Txt>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
