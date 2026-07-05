/**
 * المختارات — the full curated list behind Home's «عرض الكل» next to مختارات.
 * Staff-picked published lectures in their chosen order, each reusing the
 * section-page LectureRowItem (tap to play, resume status, download).
 *
 * Route: /(student)/featured
 */
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Divider, IconButton, Screen, Txt, cardRowStyle } from '@/components/ui';
import { LectureRowItem } from '@/components/section/LectureRowItem';
import { colors } from '@/constants/theme';
import { useFeaturedLectures } from '@/hooks/useLecture';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import type { LectureRow } from '@/api/types';

export default function FeaturedLecturesScreen() {
  const router = useRouter();
  const { data, isLoading } = useFeaturedLectures();
  const lectures = data ?? [];
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();

  const renderItem = useCallback(
    ({ item, index }: { item: LectureRow; index: number }) => (
      <View style={cardRowStyle(index === 0, index === lectures.length - 1)}>
        <LectureRowItem lecture={item} />
      </View>
    ),
    [lectures.length],
  );

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 22,
      }}
    >
      <Txt size={22} weight="display" color={colors.primaryTeal}>
        المختارات
      </Txt>
      <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
    </View>
  );

  if (isLoading) {
    return (
      <Screen scroll={false} bottomPad={118} padded>
        {header}
        <View style={{ paddingVertical: 60, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: miniPad + insets.bottom + 24 }}
        data={lectures}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Divider}
        initialNumToRender={10}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ paddingVertical: 60, alignItems: 'center', gap: 8 }}>
            <Txt size={14} color={colors.textMuted} align="center">
              لا توجد مختارات بعد
            </Txt>
            <Txt size={12} color={colors.textGhost} align="center">
              تابع قريباً
            </Txt>
          </View>
        }
      />
    </Screen>
  );
}
