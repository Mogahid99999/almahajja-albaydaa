import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Home entry into ساحة الأسئلة (V6 Feature A) — a quiet card in the Home stack,
 * shaped like JourneyHomeCard. Open to everyone (guests may read; asking nudges
 * them to register inside).
 */
export function QuestionsHomeCard() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/(student)/questions')}
      accessibilityRole="button"
      accessibilityLabel="ساحة الأسئلة"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 12 })}
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
            <Feather name="help-circle" size={20} color={colors.onTealPrimary} />
          </View>

          <View style={{ flex: 1 }}>
            <Txt weight="display" size={17} color={colors.primaryTeal}>
              مساحة الأسئلة
            </Txt>
            <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
              اسأل الشيخ، وانتفع بأسئلة إخوانك
            </Txt>
          </View>

          <Feather name="chevron-left" size={18} color={colors.textGhost} />
        </View>
      </Card>
    </Pressable>
  );
}
