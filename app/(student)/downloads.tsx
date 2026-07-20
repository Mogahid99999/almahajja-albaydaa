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
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';

import { useDownloadedLectures } from '@/hooks/useDownloads';
import { RestoreDownloadsDialog } from '@/components/downloads/RestoreDownloadsDialog';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { colors } from '@/constants/theme';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
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
  const miniPad = useMiniPlayerPad();
  const [restoreOpen, setRestoreOpen] = useState(false);
  // Restore only relinks the public (Android) folder after a reinstall — iOS/web
  // downloads live in private storage that uninstall clears entirely.
  const canRestore = Platform.OS === 'android';

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      {/* ── Nav row ──────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        {/* Back on the RIGHT (RTL): the back button leads, the title follows, and
            the restore action sits on the LEFT edge. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <IconButton
            icon="chevron-right"
            onPress={() => router.back()}
            accessibilityLabel="رجوع"
          />
        </View>
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }} numberOfLines={1}>
          المحاضرات المحمّلة
        </Txt>
        {canRestore ? (
          <IconButton
            icon="download-cloud"
            onPress={() => setRestoreOpen(true)}
            accessibilityLabel="استعادة التحميلات"
          />
        ) : null}
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
          {canRestore ? (
            <Pressable
              onPress={() => setRestoreOpen(true)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.borderSand2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name="download-cloud" size={16} color={colors.primaryTeal} />
              <Txt size={13} weight="semibold" color={colors.primaryTeal}>
                استعادة تحميلات سابقة
              </Txt>
            </Pressable>
          ) : null}
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

      <RestoreDownloadsDialog visible={restoreOpen} onClose={() => setRestoreOpen(false)} />
    </Screen>
  );
}
