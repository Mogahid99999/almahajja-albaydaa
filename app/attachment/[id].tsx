/**
 * In-app transcript reader — /attachment/[id]
 *
 * Opens for transcript (تفريغ) attachments tapped from a section page or the
 * player. Calm manuscript reading surface: nav bar + title + Amiri body text.
 * Non-transcript attachments open their URL directly and never route here.
 */
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useAttachment } from '@/hooks/useAttachments';
import { colors, fonts } from '@/constants/theme';
import { Screen, Txt } from '@/components/ui';
import { SectionNavBar } from '@/components/section/SectionNavBar';

export default function AttachmentReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useAttachment(id ?? '');

  if (isLoading) {
    return (
      <Screen scroll={false} padded>
        <SectionNavBar contextLabel="تفريغ" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen scroll={false} padded>
        <SectionNavBar contextLabel="تفريغ" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center">
            المرفق غير موجود
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            لا يمكن تحميل هذا التفريغ
          </Txt>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 22 }}>
        <SectionNavBar contextLabel={data.description ?? 'تفريغ'} />
      </View>

      <View style={{ paddingHorizontal: 22, marginTop: 8 }}>
        <Txt size={24} weight="display" color={colors.primaryTeal}>
          {data.title}
        </Txt>

        <Txt
          size={16}
          color={colors.textInk}
          style={{ marginTop: 20, fontFamily: fonts.displayRegular, lineHeight: 32 }}
        >
          {data.body ?? 'لا يوجد نص لهذا التفريغ.'}
        </Txt>
      </View>
    </Screen>
  );
}
