/**
 * «مباشر الآن» — the Home feature card shown IN PLACE of «أكمِل الاستماع» while
 * a session is live (PLAN_LIVE_V23 §1.1 item 1, prototype A `liveCard`, §15
 * home.card). Teal card, emblem, title · section · sheikh, then the room's
 * pulse: «{count} في الحلقة» · «الشيخ يتحدث» · «استمع» / «العودة إلى الحلقة».
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { LiveSessionPublic } from '@/api/live';
import { ConcentricMotif, RhombusEmblem, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useLiveStore } from '@/stores/liveStore';
import { LiveMarker, VoiceBars } from './LiveAvatar';
import { LIVE_COPY, inRoomLine, liveRoomHref, roleKind, startedAgoLine } from './liveUi';

/** Re-renders every `ms` (only this card's clock line uses it). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function LiveHomeCard({
  session,
  listenerCount,
}: {
  session: LiveSessionPublic;
  /**
   * Current attendance when the caller knows it from outside the room. While
   * I'm IN this session the store's live counts win.
   */
  listenerCount?: number | null;
}) {
  const router = useRouter();
  const now = useNow(30_000);
  const joined = useLiveStore((s) => s.session?.id === session.id);
  const brothers = useLiveStore((s) => s.counts?.brothers ?? 0);
  const sisters = useLiveStore((s) => s.counts?.sisters ?? 0);
  const sheikhSpeaking = useLiveStore((s) => {
    const id = s.activeSpeakers[0];
    return !!id && roleKind(s.people[id]?.role) === 'host' && !s.paused;
  });

  const count = joined ? brothers + sisters : (listenerCount ?? null);
  const started = startedAgoLine(session.startedAt, now);
  const sub = [session.sectionTitle, session.sheikhName].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={() => router.push(liveRoomHref(session.id))}
      accessibilityRole="button"
      accessibilityLabel={`بث مباشر: ${session.title}`}
      style={({ pressed }) => ({
        backgroundColor: colors.primaryTeal,
        borderRadius: radius.feature,
        paddingTop: 18,
        paddingHorizontal: 18,
        paddingBottom: 16,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        ...shadows.feature,
      })}
    >
      <ConcentricMotif size={210} color="rgba(176,137,79,0.16)" rings={3} style={{ left: -72, top: -72 }} />

      {/* «مباشر الآن» pill · «بدأ منذ {n} دقيقة» */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            height: 28,
            paddingHorizontal: 11,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <LiveMarker onTeal />
          <Txt size={12} weight="medium" color={colors.onTealPrimary}>
            {LIVE_COPY.liveNow}
          </Txt>
        </View>
        {started ? (
          <Txt size={11.5} color={colors.onTealSecondary} tabular>
            {started}
          </Txt>
        ) : null}
      </View>

      {/* Emblem · title · section · sheikh */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
        <View style={{ borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(201,164,99,0.45)', padding: 3 }}>
          <RhombusEmblem size={56} radius={16} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="display" size={19} color={colors.onTealPrimary} style={{ lineHeight: 27 }} numberOfLines={2}>
            {session.title}
          </Txt>
          {sub ? (
            <Txt size={12} color={colors.onTealSecondary} style={{ marginTop: 3 }} numberOfLines={1}>
              {sub}
            </Txt>
          ) : null}
        </View>
      </View>

      {/* «{count} في الحلقة» · «الشيخ يتحدث» · «استمع» / «العودة إلى الحلقة» */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
        {count != null && count > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="users" size={14} color={colors.onTealSecondary} />
            <Txt size={12} color={colors.onTealSecondary} tabular>
              {inRoomLine(count)}
            </Txt>
          </View>
        ) : null}
        {sheikhSpeaking ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <VoiceBars color={colors.accentBrass} height={12} />
            <Txt size={12} color={colors.accentBrass}>
              {LIVE_COPY.sheikhSpeaking}
            </Txt>
          </View>
        ) : null}
        <View
          style={{
            marginStart: 'auto',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: colors.accentBrass,
            borderRadius: radius.input,
            paddingVertical: 8,
            paddingHorizontal: 14,
          }}
        >
          <Feather name={joined ? 'maximize-2' : 'headphones'} size={15} color={colors.primaryTealDeep} />
          <Txt size={13.5} weight="semibold" color={colors.primaryTealDeep}>
            {joined ? LIVE_COPY.backToRoom : LIVE_COPY.listen}
          </Txt>
        </View>
      </View>
    </Pressable>
  );
}
