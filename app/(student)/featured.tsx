/**
 * المختارات — the full curated list behind Home's «عرض الكل» next to مختارات.
 * Staff-picked published lectures in their chosen order, each reusing the
 * section-page LectureRowItem (tap to play, resume status, download).
 *
 * Route: /(student)/featured
 */
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, Divider, IconButton, Screen, Txt } from '@/components/ui';
import { LectureRowItem } from '@/components/section/LectureRowItem';
import { colors } from '@/constants/theme';
import { useFeaturedLectures } from '@/hooks/useLecture';

export default function FeaturedLecturesScreen() {
  const router = useRouter();
  const { data: lectures, isLoading } = useFeaturedLectures();

  return (
    <Screen bottomPad={118} padded>
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
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

      {isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : (lectures ?? []).length === 0 ? (
        <View style={{ paddingVertical: 60, alignItems: 'center', gap: 8 }}>
          <Txt size={14} color={colors.textMuted} align="center">
            لا توجد مختارات بعد
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            تابع قريباً
          </Txt>
        </View>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {(lectures ?? []).map((lecture, index) => (
            <View key={lecture.id}>
              {index > 0 ? <Divider /> : null}
              <LectureRowItem lecture={lecture} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
