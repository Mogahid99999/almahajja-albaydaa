/**
 * أحدث الدروس — the full list behind Home's «عرض الكل» next to أُضيف حديثاً.
 * Newly-added published lectures across the app, newest first, each reusing the
 * section-page LectureRowItem (tap to play, resume status, download).
 *
 * Route: /(student)/recent
 */
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { Divider, IconButton, Screen, Txt, cardRowStyle } from '@/components/ui';
import { LectureRowItem } from '@/components/section/LectureRowItem';
import { colors } from '@/constants/theme';
import { useRecentLectures } from '@/hooks/useLecture';
import type { LectureRow } from '@/api/types';

export default function RecentLecturesScreen() {
  const router = useRouter();
  const { data, isLoading } = useRecentLectures();
  const lectures = data ?? [];

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
        أحدث الدروس
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
    <Screen scroll={false} bottomPad={118} padded>
      <FlatList
        style={{ flex: 1 }}
        data={lectures}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Divider}
        initialNumToRender={10}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ paddingVertical: 60, alignItems: 'center', gap: 8 }}>
            <Txt size={14} color={colors.textMuted} align="center">
              لا توجد دروس بعد
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
