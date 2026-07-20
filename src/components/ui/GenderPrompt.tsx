/**
 * GenderPrompt — نافذة تحديد الجنس (iOS deferred-gender flow).
 *
 * On iOS the account-creation screen no longer collects gender (Apple review
 * 5.1.1(v) data-minimisation). Gender is instead an INTERNAL value captured the
 * first time the user reaches a feature that needs it — the women's section
 * (قسم النساء) or رفيق الدراسة — via this modal. Once saved it flows into
 * `profiles.gender` (through {@link useUpdateProfile} → set_own_profile), and
 * the existing server-side gender gating (migration 0049 / 0072) does the rest.
 *
 * It is deliberately generic: the caller decides WHY it's shown (the prompt
 * copy) and what to do once a gender is chosen (`onResolved` receives the
 * selected gender so a "female-only" gate can act immediately without waiting
 * on a refetch). Used on both iOS and — harmlessly — anywhere else, but the
 * registration form keeps its own inline picker on Android.
 */
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import type { Gender } from '@/api/types';
import { colors, radius, shadows } from '@/constants/theme';
import { useUpdateProfile } from '@/hooks/useAuth';
import { GenderPills } from './GenderPills';
import { Txt } from './Txt';

export function GenderPrompt({
  visible,
  onClose,
  onResolved,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called after the gender is persisted — receives the chosen value so the
   *  caller can immediately allow/deny (female → allow قسم النساء, male → deny). */
  onResolved: (gender: Gender) => void;
  /** Why the prompt is shown (feature-specific one-liner). */
  message: string;
}) {
  const [gender, setGender] = useState<Gender | null>(null);
  const [error, setError] = useState(false);
  const update = useUpdateProfile();

  const onConfirm = () => {
    if (!gender) {
      setError(true);
      return;
    }
    update.mutate(
      { gender },
      {
        onSuccess: () => {
          setGender(null);
          setError(false);
          onClose();
          onResolved(gender);
        },
      },
    );
  };

  const onCancel = () => {
    setGender(null);
    setError(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 22,
            paddingTop: 22,
            paddingBottom: 28,
            gap: 16,
          }}
        >
          <Txt weight="display" size={18} color={colors.primaryTeal} align="center">
            تحديد الجنس
          </Txt>
          <Txt size={13.5} color={colors.textMuted} align="center" style={{ lineHeight: 23 }}>
            {message}
          </Txt>

          <GenderPills
            value={gender}
            onChange={(g) => {
              setGender(g);
              setError(false);
            }}
          />
          {error ? (
            <Txt size={12} color={colors.stateDanger} align="center">
              يرجى تحديد الجنس
            </Txt>
          ) : null}

          {update.isError ? (
            <Txt size={12} color={colors.stateDanger} align="center">
              تعذّر الحفظ، حاول مرة أخرى
            </Txt>
          ) : null}

          <Pressable
            onPress={onConfirm}
            disabled={update.isPending}
            style={[
              {
                backgroundColor: colors.primaryTeal,
                borderRadius: radius.input,
                paddingVertical: 14,
                alignItems: 'center',
                opacity: update.isPending ? 0.5 : 1,
              },
              shadows.button,
            ]}
          >
            <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
              {update.isPending ? 'جارٍ الحفظ…' : 'متابعة'}
            </Txt>
          </Pressable>

          <Pressable onPress={onCancel} style={{ alignItems: 'center', paddingVertical: 4 }}>
            <Txt size={13} weight="semibold" color={colors.textMuted}>
              رجوع
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
