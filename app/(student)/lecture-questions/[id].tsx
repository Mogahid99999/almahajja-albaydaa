/**
 * أسئلة الدرس — per-lesson Q&A (V6 Feature A).
 * Route: /(student)/lecture-questions/[id] (player «أدوات الدرس» + deep-link).
 */
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { IconButton, Screen, Txt } from '@/components/ui';
import { QuestionsBoard } from '@/components/questions/QuestionsBoard';
import { colors } from '@/constants/theme';
import { useLecturePlayback } from '@/hooks/useLecture';

export default function LectureQuestionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: lecture } = useLecturePlayback(id ?? '');

  return (
    <Screen bottomPad={118} padded>
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
        <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 18 }} numberOfLines={2}>
          {lecture.title}
        </Txt>
      ) : (
        <View style={{ marginBottom: 18 }} />
      )}

      {id ? <QuestionsBoard scope="lecture" lectureId={id} /> : null}
    </Screen>
  );
}
