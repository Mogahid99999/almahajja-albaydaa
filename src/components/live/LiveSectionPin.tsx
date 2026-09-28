/**
 * The section page's live pin (PLAN_LIVE_V23 §7.3, prototype `DD.section` pin):
 *  - live in THIS section   → teal pin «يُبث الآن…» + «استمع» / «عودة»
 *  - scheduled here         → sand pin «مباشر · {day time}»
 * Renders nothing otherwise. TODO(P4/P6): the review state and the staff
 * «ابدأ» CTA (green room).
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ConcentricMotif, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useLiveNow } from '@/hooks/useLive';
import { useLiveStore } from '@/stores/liveStore';
import { LiveMarker } from './LiveAvatar';
import { useNow } from './LiveHomeCard';
import { LIVE_COPY, arClock, arDayLabel, inRoomLine, liveRoomHref } from './liveUi';

export function LiveSectionPin({ sectionId }: { sectionId: string }) {
  const router = useRouter();
  const { data } = useLiveNow();
  const now = useNow(60_000);
  const joinedId = useLiveStore((s) => s.session?.id ?? null);
  const brothers = useLiveStore((s) => s.counts?.brothers ?? 0);
  const sisters = useLiveStore((s) => s.counts?.sisters ?? 0);

  const live = data?.live && data.live.sectionId === sectionId ? data.live : null;
  const upcoming = live ? null : (data?.upcoming ?? []).find((u) => u.sectionId === sectionId) ?? null;

  if (live) {
    const joined = joinedId === live.id;
    const count = joined ? brothers + sisters : 0;
    return (
      <Pressable
        onPress={() => router.push(liveRoomHref(live.id))}
        accessibilityRole="button"
        accessibilityLabel={`بث مباشر: ${live.title}`}
        style={({ pressed }) => [
          {
            marginTop: 14,
            borderRadius: 20,
            backgroundColor: colors.primaryTeal,
            paddingVertical: 14,
            paddingHorizontal: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            overflow: 'hidden',
            opacity: pressed ? 0.92 : 1,
          },
          shadows.feature,
        ]}
      >
        <ConcentricMotif size={160} color="rgba(176,137,79,0.16)" rings={3} style={{ left: -60, top: -60 }} />
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(255,255,255,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LiveMarker onTeal />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="display" size={17} color={colors.onTealPrimary} style={{ lineHeight: 24 }} numberOfLines={1}>
            {live.title}
          </Txt>
          <Txt size={12} color={colors.onTealSecondary} numberOfLines={1}>
            {count > 0 ? `يُبث الآن · ${inRoomLine(count)}` : 'يُبث الآن'}
          </Txt>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: colors.accentBrass,
            borderRadius: radius.input,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <Feather name="headphones" size={15} color={colors.primaryTealDeep} />
          <Txt size={13} weight="semibold" color={colors.primaryTealDeep}>
            {joined ? 'عودة' : LIVE_COPY.listen}
          </Txt>
        </View>
      </Pressable>
    );
  }

  if (upcoming) {
    return (
      <View
        style={{
          marginTop: 14,
          borderRadius: 20,
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.borderSand,
          paddingVertical: 14,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.surfaceInset,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="calendar" size={16} color={colors.accentBrassMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="display" size={17} style={{ lineHeight: 24 }} numberOfLines={1}>
            {upcoming.title}
          </Txt>
          <Txt size={12} color={colors.textFaint} numberOfLines={1}>
            {`مباشر · ${arDayLabel(upcoming.scheduledAt, now)} ${arClock(upcoming.scheduledAt)}`}
          </Txt>
        </View>
      </View>
    );
  }

  return null;
}
