/**
 * أسئلة الدرس — per-lesson Q&A (V6 Feature A).
 * Route: /(student)/lecture-questions/[id] (player «أدوات الدرس» + deep-link).
 */
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { IconButton, Screen, Txt } from '@/components/ui';
import { QuestionsBoard } from '@/components/questions/QuestionsBoard';
import { colors } from '@/constants/theme';
import { useQnaNotice } from '@/hooks/useAppContent';
import { useLecturePlayback } from '@/hooks/useLecture';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

export default function LectureQuestionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: lecture } = useLecturePlayback(id ?? '');
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const { data: qnaNotice } = useQnaNotice();

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
          أسئلة الدرس
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>
      {lecture?.title ? (
        <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 6 }} numberOfLines={2}>
          {lecture.title}
        </Txt>
      ) : null}
      {qnaNotice?.text ? (
        <Txt size={11.5} color={colors.textGhost} style={{ marginBottom: 18, lineHeight: 18 }}>
          {qnaNotice.text}
        </Txt>
      ) : (
        <View style={{ marginBottom: 18 }} />
      )}

      {id ? (
        <QuestionsBoard
          scope="lecture"
          lectureId={id}
          bottomPad={miniPad + insets.bottom + 24 + BOTTOM_NAV_CLEARANCE}
        />
      ) : null}
    </Screen>
  );
}
