import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, TextInput, View, type ViewStyle } from 'react-native';

import type { FeedbackCategory } from '@/api/feedback';
import { BlockedWordError } from '@/api/reports';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, radius } from '@/constants/theme';
import { useSubmitFeedback } from '@/hooks/useFeedback';

const CATEGORIES: { value: FeedbackCategory; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: 'bug', label: 'مشكلة', icon: 'alert-triangle' },
  { value: 'improvement', label: 'اقتراح تحسين', icon: 'trending-up' },
  { value: 'other', label: 'أخرى', icon: 'message-circle' },
];

function CategoryChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: radius.pill,
          backgroundColor: active ? colors.primaryTeal : colors.surfaceWhite,
          borderWidth: 1.5,
          borderColor: active ? colors.primaryTeal : colors.borderSand2,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Feather name={icon} size={14} color={active ? colors.onTealPrimary : colors.textSlate} />
      <Txt size={13} weight={active ? 'semibold' : 'medium'} color={active ? colors.onTealPrimary : colors.textSlate}>
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * Bottom-sheet «إرسال ملاحظة» — a guided, three-tap-minimum flow (pick a
 * category, write a few words, send). Device/app-version info is attached
 * silently server-side (see collectDeviceInfo in src/api/feedback.ts) so the
 * student never has to think about it. Never requires an account — guest
 * sessions may submit too, same as ReportSheet.
 */
export function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const submit = useSubmitFeedback();

  useEffect(() => {
    if (visible) {
      setCategory(null);
      setMessage('');
      setSent(false);
      submit.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmed = message.trim();
  const canSubmit = !!category && trimmed.length >= 3 && !submit.isPending;

  const errorMessage =
    submit.error instanceof BlockedWordError
      ? submit.error.message
      : submit.error
        ? 'تعذّر إرسال الملاحظة، حاول مرة أخرى'
        : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The app is edge-to-edge, so the keyboard OVERLAYS this modal instead of
          resizing it — `padding` lifts the whole backdrop (and the flex-end-anchored
          sheet inside it) above the keyboard, same fix as the lecture-note editor. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
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

            {sent ? (
              <View style={{ alignItems: 'center', paddingVertical: 16, gap: 10 }}>
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: colors.primaryTeal,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Feather name="check" size={26} color={colors.onTealPrimary} />
                </View>
                <Txt weight="display" size={18} color={colors.primaryTeal} align="center">
                  شكرًا لك
                </Txt>
                <Txt size={13} color={colors.textMuted} align="center" style={{ lineHeight: 21 }}>
                  وصلت ملاحظتك إلى فريق العمل، بارك الله فيك
                </Txt>
              </View>
            ) : (
              <>
                <Txt weight="display" size={18} color={colors.primaryTeal} align="center">
                  إرسال ملاحظة
                </Txt>
                <Txt size={12.5} color={colors.textMuted} align="center" style={{ lineHeight: 20 }}>
                  نرحّب بملاحظاتك — تصل مباشرة إلى فريق العمل
                </Txt>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {CATEGORIES.map((c) => (
                    <CategoryChip
                      key={c.value}
                      label={c.label}
                      icon={c.icon}
                      active={category === c.value}
                      onPress={() => setCategory(c.value)}
                    />
                  ))}
                </View>

                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="اكتب ملاحظتك هنا…"
                  placeholderTextColor={colors.textGhost}
                  multiline
                  textAlign="right"
                  textAlignVertical="top"
                  maxLength={2000}
                  style={{
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
                  }}
                />

                {errorMessage ? (
                  <Txt size={12.5} color={colors.stateDanger} align="center">
                    {errorMessage}
                  </Txt>
                ) : null}

                <Pressable
                  onPress={() => {
                    if (!category) return;
                    submit.mutate(
                      { category, message: trimmed },
                      { onSuccess: () => setSent(true) },
                    );
                  }}
                  disabled={!canSubmit}
                  accessibilityRole="button"
                  style={({ pressed }) =>
                    ({
                      marginTop: 4,
                      paddingVertical: 14,
                      borderRadius: radius.input,
                      alignItems: 'center',
                      backgroundColor: colors.primaryTeal,
                      opacity: pressed || !canSubmit ? 0.6 : 1,
                    }) as ViewStyle
                  }
                >
                  <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
                    {submit.isPending ? 'جارٍ الإرسال…' : 'إرسال'}
                  </Txt>
                </Pressable>
              </>
            )}

            <Pressable onPress={onClose} disabled={submit.isPending} style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Txt size={13} weight="medium" color={colors.textMuted}>
                {sent ? 'إغلاق' : 'إلغاء'}
              </Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
