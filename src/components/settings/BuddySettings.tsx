import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import type { BuddyStatus } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useCancelBuddy, useMyBuddies } from '@/hooks/useBuddy';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Profile settings — رفيق الدراسة (26.2 Phase F). Renders one "إنهاء الرفقة"
 * action per accepted buddy (up to 3), each behind a confirmation sheet that
 * ends only that pairing. (The buddy notification toggle lives with the other
 * per-type toggles in PrefsToggles — type 'buddy_activity'.)
 */
export function BuddySettings() {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: buddies } = useMyBuddies({ enabled: !isGuest });
  const cancel = useCancelBuddy();
  const [confirming, setConfirming] = useState<BuddyStatus | null>(null);

  if (isGuest || !buddies || buddies.length === 0) return null;

  const onConfirm = () => {
    if (!confirming) return;
    cancel.mutate(confirming.buddyId, { onSuccess: () => setConfirming(null) });
  };

  return (
    <>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {buddies.map((buddy, i) => (
          <Pressable
            key={buddy.buddyId}
            accessibilityRole="button"
            accessibilityLabel={`إنهاء رفقة ${buddy.displayName}`}
            onPress={() => setConfirming(buddy)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 14,
              paddingHorizontal: 16,
              opacity: pressed ? 0.7 : 1,
              gap: 12,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.borderSand2,
            })}
          >
            <Feather name="user-x" size={18} color={colors.stateDanger} />
            <Txt size={14} weight="medium" color={colors.stateDanger} style={{ flex: 1 }}>
              {`إنهاء رفقة ${buddy.displayName}`}
            </Txt>
          </Pressable>
        ))}
      </Card>

      <Modal
        visible={!!confirming}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirming(null)}
      >
        <Pressable
          onPress={() => setConfirming(null)}
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
              {`هل تريد إنهاء رفقة ${confirming?.displayName ?? ''}؟ يمكنك اختيار رفيق آخر لاحقًا`}
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
              onPress={() => setConfirming(null)}
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
