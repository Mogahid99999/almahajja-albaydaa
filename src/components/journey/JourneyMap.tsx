import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { JourneyMapEntry } from '@/api/journey';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { preloadLecture } from '@/lib/audioController';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';

/** One touched-series row: breadcrumb, %, completed/total, continue button. */
function SeriesRow({ e }: { e: JourneyMapEntry }) {
  const router = useRouter();
  const pct = e.total > 0 ? Math.round((e.completed / e.total) * 100) : 0;
  const done = e.completed >= e.total && e.total > 0;

  function go() {
    if (e.nextLectureId) {
      void preloadLecture(e.nextLectureId, { startAtSec: 0 });
      router.push(`/player/${e.nextLectureId}`);
    } else {
      router.push(`/(student)/section/${e.sectionId}`);
    }
  }

  return (
    <Card style={{ gap: 8 }}>
      {e.parentTitle ? (
        <Txt size={11.5} weight="medium" color={colors.accentBrassMuted} numberOfLines={1}>
          {`${e.parentTitle} ← ${e.sectionTitle}`}
        </Txt>
      ) : (
        <Txt size={11.5} weight="medium" color={colors.accentBrassMuted} numberOfLines={1}>
          {e.sectionTitle}
        </Txt>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt size={13} color={colors.textMuted} tabular>
          {`أنجزت ${arNum(e.completed)} من ${arNum(e.total)} درساً`}
        </Txt>
        <Txt size={13} weight="semibold" color={colors.primaryTeal600} tabular>
          {`${arNum(pct)}%`}
        </Txt>
      </View>

      <ProgressBar value={e.total > 0 ? e.completed / e.total : 0} height={6} tint="teal" />

      <Pressable
        onPress={go}
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          marginTop: 2,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
          {done ? 'عرض السلسلة' : 'متابعة السلسلة'}
        </Txt>
      </Pressable>
    </Card>
  );
}

/**
 * «خريطة رحلتي» (V20 · §6) — the series the student has touched, with each one's
 * progress and a continue action. `limit` shows only the most-recent few on the
 * journey page; the full screen passes no limit. No locking, no forced order.
 */
export function JourneyMap({ entries, limit }: { entries: JourneyMapEntry[]; limit?: number }) {
  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <View style={{ gap: 12 }}>
      {shown.map((e) => (
        <SeriesRow key={e.sectionId} e={e} />
      ))}
    </View>
  );
}
