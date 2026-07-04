import { View } from 'react-native';

import type { QuizStatus } from '@/api/types';
import { Txt } from '@/components/ui';
import { radius } from '@/constants/theme';
import { QUIZ_STATUS_META } from './quizStatus';

export function QuizStatusPill({ status }: { status: QuizStatus }) {
  const meta = QUIZ_STATUS_META[status];
  return (
    <View
      style={{
        backgroundColor: meta.bg,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Txt size={11} weight="semibold" color={meta.fg}>
        {meta.label}
      </Txt>
    </View>
  );
}
