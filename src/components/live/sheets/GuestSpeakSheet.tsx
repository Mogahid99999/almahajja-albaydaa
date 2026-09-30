/**
 * A guest taps «طلب التحدث» (owner rule, 2026-09-28): guests listen like
 * everyone else, but asking to speak needs an account — say so calmly and offer
 * «تسجيل». The room keeps playing (the caller minimises it to the mini-bar).
 */
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { LiveSheet } from './LiveSheet';

export function GuestSpeakSheet({
  visible,
  onClose,
  onRegister,
}: {
  visible: boolean;
  onClose: () => void;
  onRegister: () => void;
}) {
  return (
    <LiveSheet visible={visible} onClose={onClose} title="سجّل أولاً لتطلب التحدث">
      <Txt size={13.5} color={colors.textSlate} style={{ lineHeight: 24 }}>
        الاستماع إلى المجلس متاح لك كما هو، أما طلب التحدث فللمسجّلين فقط.
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <Pressable
          onPress={onRegister}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flex: 1,
            height: 48,
            borderRadius: radius.input + 4,
            backgroundColor: colors.primaryTeal,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
            تسجيل
          </Txt>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => ({
            height: 48,
            paddingHorizontal: 22,
            borderRadius: radius.input + 4,
            backgroundColor: colors.surfaceInset,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Txt size={15} weight="medium" color={colors.textSlate}>
            ليس الآن
          </Txt>
        </Pressable>
      </View>
    </LiveSheet>
  );
}
