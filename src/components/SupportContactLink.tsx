/**
 * SupportContactLink — the «تواصل مع الدعم الفني» Telegram entry (V14 item 4).
 *
 * One shared implementation for the sign-in screen and Home. Driven by the
 * admin-editable `support_whatsapp_url` config key (the owner points it at
 * Telegram now — the key name is historical) via useSupportContact; an empty
 * value hides the row entirely, same "empty = hidden" convention as the About
 * Telegram button. No backend/admin change needed — the key is already in
 * SETTINGS_KEYS.
 *
 * V16: upgraded from a quiet text line to a proper card row (same shape as
 * QuestionsHomeCard) — the owner asked for the support entry to be clearly
 * visible instead of easy to miss.
 */
import Feather from '@expo/vector-icons/Feather';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Linking, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';
import { colors } from '@/constants/theme';
import { useSupportContact } from '@/hooks/useAppContent';

export function SupportContactLink({ style }: { style?: StyleProp<ViewStyle> }) {
  const { data: support } = useSupportContact();
  const supportUrl = support?.whatsappUrl ?? '';

  if (!supportUrl) return null;

  return (
    <Pressable
      onPress={() => Linking.openURL(supportUrl)}
      accessibilityRole="button"
      accessibilityLabel="تواصل مع الدعم الفني عبر تيليجرام"
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }, style]}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              borderWidth: 2,
              borderColor: colors.accentBrass,
              backgroundColor: colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FontAwesome name="telegram" size={20} color={colors.onTealPrimary} />
          </View>

          <View style={{ flex: 1 }}>
            <Txt weight="display" size={17} color={colors.primaryTeal}>
              الدعم الفني
            </Txt>
            <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
              هل لديك مشكلة؟ تواصل معنا عبر تيليجرام
            </Txt>
          </View>

          <Feather name="chevron-left" size={18} color={colors.textGhost} />
        </View>
      </Card>
    </Pressable>
  );
}
