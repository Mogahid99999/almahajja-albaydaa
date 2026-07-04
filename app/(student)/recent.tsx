/**
 * أحدث الدروس — the full list behind Home's «عرض الكل» next to أُضيف حديثاً.
 * Newly-added published lectures across the app, newest first, each reusing the
 * section-page LectureRowItem (tap to play, resume status, download).
 *
 * Route: /(student)/recent
 */
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, Divider, IconButton, Screen, Txt } from '@/components/ui';
import { LectureRowItem } from '@/components/section/LectureRowItem';
import { colors } from '@/constants/theme';
import { useRecentLectures } from '@/hooks/useLecture';

export default function RecentLecturesScreen() {
  const router = useRouter();
  const { data: lectures, isLoading } = useRecentLectures();

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
          أحدث الدروس
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
            لا توجد دروس بعد
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
