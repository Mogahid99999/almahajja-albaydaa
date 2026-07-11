/**
 * SupportContactLink — the «تواصل مع الدعم الفني» Telegram row (V14 item 4).
 *
 * One shared implementation for the sign-in screen and Home. Driven by the
 * admin-editable `support_whatsapp_url` config key (the owner points it at
 * Telegram now — the key name is historical) via useSupportContact; an empty
 * value hides the row entirely, same "empty = hidden" convention as the About
 * Telegram button. No backend/admin change needed — the key is already in
 * SETTINGS_KEYS.
 */
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Linking, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSupportContact } from '@/hooks/useAppContent';

export function SupportContactLink({ style }: { style?: StyleProp<ViewStyle> }) {
  const { data: support } = useSupportContact();
  const supportUrl = support?.whatsappUrl ?? '';

  if (!supportUrl) return null;

  return (
    <Pressable
      onPress={() => Linking.openURL(supportUrl)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="تواصل مع الدعم الفني عبر تيليجرام"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          paddingVertical: 6,
        },
        style,
        pressed && { opacity: 0.6 },
      ]}
    >
      <FontAwesome name="telegram" size={15} color={colors.accentBrassMuted} />
      <Txt size={12} color={colors.textMuted}>
        هل لديك مشكلة؟ تواصل مع الدعم الفني للمنصة
      </Txt>
    </Pressable>
  );
}
