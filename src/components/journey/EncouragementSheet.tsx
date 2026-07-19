import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { ENCOURAGEMENT_PHRASES } from '@/api/encouragement';
import { arabicOr } from '@/lib/errorText';
import { colors, radius } from '@/constants/theme';
import { useSendEncouragement } from '@/hooks/useBuddyGoals';
import { Txt } from '@/components/ui/Txt';

/**
 * «تشجيع رفيقك» — pick one of 8 fixed du'a-style phrases to send a buddy (V20 ·
 * §14). No free text; one per buddy per 24h (server-enforced — the Arabic cap
 * message surfaces on the button). The phrases render as small du'a cards in the
 * display font for a calm, spiritual feel. Full RTL.
 */
export function EncouragementSheet({
  visible,
  buddyId,
  buddyName,
  onClose,
}: {
  visible: boolean;
  buddyId: string;
  buddyName: string;
  onClose: () => void;
}) {
  const send = useSendEncouragement();
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(key: string) {
    setError(null);
    send.mutate(
      { toUserId: buddyId, phraseKey: key },
      {
        onSuccess: () => {
          setSentKey(key);
          setTimeout(onClose, 1100);
        },
        onError: (e) =>
          setError(arabicOr(e, 'تعذّر إرسال التشجيع، حاول لاحقًا')),
      },
    );
  }

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
            paddingBottom: 28,
            gap: 12,
            maxHeight: '80%',
          }}
        >
          <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderSand2 }} />
          <Txt weight="display" size={17} color={colors.primaryTeal} align="center">
            {`تشجيع ${buddyName}`}
          </Txt>

          {error ? (
            <Txt size={12.5} color={colors.stateDanger} align="center">
              {error}
            </Txt>
          ) : null}

          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            {ENCOURAGEMENT_PHRASES.map((p) => {
              const isSent = sentKey === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => pick(p.key)}
                  disabled={send.isPending}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    paddingVertical: 16,
                    paddingHorizontal: 16,
                    borderRadius: radius.card,
                    backgroundColor: isSent ? colors.primaryTeal : colors.surfaceCard,
                    borderWidth: 1,
                    borderColor: isSent ? colors.primaryTeal : colors.borderSand,
                    opacity: pressed || send.isPending ? 0.7 : 1,
                  })}
                >
                  <Txt
                    weight="display"
                    size={14.5}
                    align="center"
                    color={isSent ? colors.onTealPrimary : colors.textInk}
                    style={{ lineHeight: 24 }}
                  >
                    {isSent ? 'تم الإرسال — بارك الله فيكما' : p.text}
                  </Txt>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
