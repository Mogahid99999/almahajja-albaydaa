import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, TextInput, View, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { colors, fonts, radius } from '@/constants/theme';
import { useSubmitRating } from '@/hooks/useRatings';
import { deferRatingPrompt, markRatingSubmitted } from '@/lib/ratingPrompt';

function Star({
  filled,
  onPress,
  index,
}: {
  filled: boolean;
  onPress: () => void;
  index: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${index} من ٥ نجوم`}
      hitSlop={8}
      style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.7 }]}
    >
      <Feather
        name="star"
        size={32}
        color={filled ? colors.accentBrass : colors.borderSand2}
        style={filled ? { opacity: 1 } : undefined}
      />
    </Pressable>
  );
}

/**
 * Star-rating prompt — appears after cumulative app-usage thresholds
 * (src/lib/ratingPrompt.ts). Cancel defers the next prompt by 20h; submitting
 * hides it forever. Same modal shell as FeedbackSheet (bottom sheet, tap
 * outside = cancel).
 */
export function RatingPromptModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [stars, setStars] = useState(0);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const submit = useSubmitRating();

  useEffect(() => {
    if (visible) {
      setStars(0);
      setMessage('');
      setSent(false);
      submit.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canSubmit = stars > 0 && !submit.isPending;

  const handleCancel = () => {
    void deferRatingPrompt();
    onClose();
  };

  const handleBackdropClose = sent ? onClose : handleCancel;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleBackdropClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable
          onPress={handleBackdropClose}
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
                  شكرًا لتقييمك
                </Txt>
                <Txt size={13} color={colors.textMuted} align="center" style={{ lineHeight: 21 }}>
                  بارك الله فيك، تقييمك يساعدنا على التحسين
                </Txt>
              </View>
            ) : (
              <>
                <Txt weight="display" size={18} color={colors.primaryTeal} align="center">
                  ما رأيك في التطبيق؟
                </Txt>
                <Txt size={12.5} color={colors.textMuted} align="center" style={{ lineHeight: 20 }}>
                  تقييمك يعيننا على تطوير المنصة
                </Txt>

                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} index={i} filled={i <= stars} onPress={() => setStars(i)} />
                  ))}
                </View>

                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="أخبرنا عن تجربتك (اختياري)"
                  placeholderTextColor={colors.textGhost}
                  multiline
                  textAlign="right"
                  textAlignVertical="top"
                  maxLength={2000}
                  style={{
                    minHeight: 80,
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

                {submit.error ? (
                  <Txt size={12.5} color={colors.stateDanger} align="center">
                    تعذّر إرسال التقييم، حاول مرة أخرى
                  </Txt>
                ) : null}

                <Pressable
                  onPress={() => {
                    if (stars === 0) return;
                    submit.mutate(
                      { stars, message: message.trim() || undefined },
                      {
                        onSuccess: () => {
                          void markRatingSubmitted();
                          setSent(true);
                        },
                      },
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

            <Pressable
              onPress={sent ? onClose : handleCancel}
              disabled={submit.isPending}
              style={{ alignItems: 'center', paddingVertical: 6 }}
            >
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
