/**
 * Downloads — المحاضرات المحملة
 *
 * Lists every lecture the student has downloaded to device storage, with
 * one-tap play and per-row delete (via DownloadButton). Empty state when no
 * downloads exist. 118px bottom pad clears the global MiniPlayer.
 *
 * Route: /(student)/downloads
 * Design tokens: manuscript-warm palette, RTL, calm tone.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { useDownloadedLectures } from '@/hooks/useDownloads';
import { colors } from '@/constants/theme';

import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';

import { DownloadedLectureRow } from '@/components/downloads/DownloadedLectureRow';

export default function DownloadsScreen() {
  const router = useRouter();
  const lectures = useDownloadedLectures();

  return (
    <Screen bottomPad={118} padded>
      {/* ── Nav row ──────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          المحاضرات المحمّلة
        </Txt>
        {/* chevron-right = back in RTL (mirrors left-to-right "back" semantics) */}
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {lectures.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 80,
            gap: 16,
          }}
        >
          <Rhombus size={28} color={colors.accentBrassSoft} filled={false} />
          <Txt size={14} color={colors.textMuted} align="center">
            لا توجد محاضرات محمّلة بعد
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            حمّل المحاضرات لتستمع إليها بدون اتصال
          </Txt>
        </View>
      ) : (
        /* ── Lecture list ───────────────────────────────────────────────────── */
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {lectures.map((lecture, index) => (
            <View key={lecture.id}>
              {index > 0 ? <Divider /> : null}
              <DownloadedLectureRow lecture={lecture} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
