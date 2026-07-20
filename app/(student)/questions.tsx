/**
 * ساحة الأسئلة — the general Q&A space (V6 Feature A).
 * Route: /(student)/questions (Home card + question_answered deep-link).
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { IconButton, Screen, Txt } from '@/components/ui';
import { QuestionsBoard } from '@/components/questions/QuestionsBoard';
import { colors } from '@/constants/theme';
import { useQnaNotice } from '@/hooks/useAppContent';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

export default function QuestionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const { data: qnaNotice } = useQnaNotice();

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
         مساحة الاسئلة
        </Txt>
      </View>
      <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 12, lineHeight: 20 }}>
        اسأل عمّا أشكل عليك، ويجيبك الشيخ — وتنتفع بأسئلة إخوانك
      </Txt>
      {qnaNotice?.text ? (
        <Txt size={11.5} color={colors.textGhost} style={{ marginBottom: 12, lineHeight: 18 }}>
          {qnaNotice.text}
        </Txt>
      ) : null}

      <QuestionsBoard
        scope="general"
        bottomPad={miniPad + insets.bottom + 24 + BOTTOM_NAV_CLEARANCE}
      />
    </Screen>
  );
}
