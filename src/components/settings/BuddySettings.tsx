import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBuddy, useCancelBuddy } from '@/hooks/useBuddy';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Profile settings — رفيق الدراسة (26.2 Phase F). Renders only while a buddy
 * is active: the "إلغاء رفيق الدراسة" action behind a confirmation sheet.
 * (The buddy notification toggle lives with the other per-type toggles in
 * PrefsToggles — type 'buddy_activity'.)
 */
export function BuddySettings() {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: buddy } = useBuddy({ enabled: !isGuest });
  const cancel = useCancelBuddy();
  const [confirming, setConfirming] = useState(false);

  if (isGuest || !buddy) return null;

  const onConfirm = () => {
    cancel.mutate(undefined, { onSuccess: () => setConfirming(false) });
  };

  return (
    <>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إلغاء رفيق الدراسة"
          onPress={() => setConfirming(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 14,
            paddingHorizontal: 16,
            opacity: pressed ? 0.7 : 1,
            gap: 12,
          })}
        >
          <Feather name="user-x" size={18} color={colors.stateDanger} />
          <Txt size={14} weight="medium" color={colors.stateDanger} style={{ flex: 1 }}>
            إلغاء رفيق الدراسة
          </Txt>
        </Pressable>
      </Card>

      <Modal
        visible={confirming}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirming(false)}
      >
        <Pressable
          onPress={() => setConfirming(false)}
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

            <Txt weight="display" size={19} color={colors.primaryTeal} align="center">
              إنهاء الرفقة
            </Txt>

            <Txt size={13.5} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
              {`هل تريد إنهاء رفقة ${buddy.displayName}؟ يمكنك اختيار رفيق آخر لاحقًا`}
            </Txt>

            {cancel.isError ? (
              <Txt size={12} color={colors.stateDanger} align="center">
                {(cancel.error as Error).message}
              </Txt>
            ) : null}

            <Pressable
              onPress={onConfirm}
              disabled={cancel.isPending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingVertical: 14,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.stateDanger,
                opacity: pressed || cancel.isPending ? 0.7 : 1,
              })}
            >
              <Txt size={15} weight="semibold" color={colors.surfaceWhite}>
                {cancel.isPending ? 'جارٍ الإلغاء…' : 'إنهاء الرفقة'}
              </Txt>
            </Pressable>

            <Pressable
              onPress={() => setConfirming(false)}
              accessibilityRole="button"
              style={({ pressed }) => ({ alignItems: 'center', paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
            >
              <Txt size={13} color={colors.textMuted}>
                رجوع
              </Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
