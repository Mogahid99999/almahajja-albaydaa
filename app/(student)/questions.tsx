/**
 * ساحة الأسئلة — the general Q&A space (V6 Feature A).
 * Route: /(student)/questions (Home card + question_answered deep-link).
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Screen, Txt } from '@/components/ui';
import { QuestionsBoard } from '@/components/questions/QuestionsBoard';
import { colors } from '@/constants/theme';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

export default function QuestionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
         مساحة الاسئلة
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>
      <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 18, lineHeight: 20 }}>
        اسأل عمّا أشكل عليك، ويجيبك الشيخ — وتنتفع بأسئلة إخوانك
      </Txt>

      <QuestionsBoard scope="general" bottomPad={miniPad + insets.bottom + 24} />
    </Screen>
  );
}
