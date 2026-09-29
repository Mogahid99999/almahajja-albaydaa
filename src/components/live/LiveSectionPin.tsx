/**
 * The section page's live pin (PLAN_LIVE_V23 §7.3, prototype `DD.section` pin):
 *  - live in THIS section   → teal pin «يُبث الآن…» + «استمع» / «عودة»
 *  - scheduled here         → sand pin «مباشر · {day time}»
 *  - staff's green room here (P4) → «العودة إلى غرفة التجهيز»
 *  - staff who can host (admin / publisher / sheikh — create_live_session),
 *    nothing live/green here → «ابدأ مجلساً مباشراً» → CreateLiveSheet → the
 *    green room (under a scheduled pin too).
 * Renders nothing otherwise. TODO(P6): the review state.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { ConcentricMotif, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLiveNow } from '@/hooks/useLive';
import { useSectionPage } from '@/hooks/useSections';
import { useLiveStore } from '@/stores/liveStore';
import { LiveMarker } from './LiveAvatar';
import { useNow } from './LiveHomeCard';
import {
  LIVE_COPY,
  LIVE_P4_COPY,
  arClock,
  arDayLabel,
  canStartLive,
  inRoomLine,
  liveGreenHref,
  liveRoomHref,
} from './liveUi';
import { CreateLiveSheet } from './sheets/CreateLiveSheet';

/** iOS can't present the green room while the create sheet (an RN Modal) is still dismissing. */
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 400 : 0;

export function LiveSectionPin({ sectionId }: { sectionId: string }) {
  const router = useRouter();
  const { data } = useLiveNow();
  const now = useNow(60_000);
  const joinedId = useLiveStore((s) => s.session?.id ?? null);
  const brothers = useLiveStore((s) => s.counts?.brothers ?? 0);
  const sisters = useLiveStore((s) => s.counts?.sisters ?? 0);
  const { data: user } = useCurrentUser();
  const canStart = canStartLive(user);
  // Already cached by the section page (same query) — the title prefill.
  const sectionTitle = useSectionPage(sectionId).data?.section?.title ?? '';
  const [createOpen, setCreateOpen] = useState(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    },
    [],
  );

  const live = data?.live && data.live.sectionId === sectionId ? data.live : null;
  const green = !live && data?.green && data.green.sectionId === sectionId ? data.green : null;
  const upcoming =
    live || green ? null : ((data?.upcoming ?? []).find((u) => u.sectionId === sectionId) ?? null);

  const staffStart =
    canStart && !live && !green ? (
      <>
        <StartLiveCta onPress={() => setCreateOpen(true)} />
        <CreateLiveSheet
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          sectionId={sectionId}
          initialTitle={sectionTitle}
          onCreated={(id) => {
            setCreateOpen(false);
            if (pushTimer.current) clearTimeout(pushTimer.current);
            pushTimer.current = setTimeout(() => {
              pushTimer.current = null;
              router.push(liveGreenHref(id));
            }, AFTER_SHEET_MS);
          }}
        />
      </>
    ) : null;

  if (green) {
    // Only the HOST goes back to the green room (it opens his mic, «ابدأ البث»,
    // «إلغاء»); other staff enter the room itself as moderators.
    const greenCta = green.isMine ? LIVE_P4_COPY.backToGreen : 'الدخول مشرفاً';
    return (
      <Pressable
        onPress={() => router.push(green.isMine ? liveGreenHref(green.id) : liveRoomHref(green.id))}
        accessibilityRole="button"
        accessibilityLabel={`${greenCta}: ${green.title}`}
        style={({ pressed }) => ({
          marginTop: 14,
          borderRadius: 20,
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: 'rgba(176,137,79,0.45)',
          paddingVertical: 14,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.9 : 1,
        })}
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
          <Feather name="mic" size={16} color={colors.primaryTeal} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="display" size={17} style={{ lineHeight: 24 }} numberOfLines={1}>
            {green.title}
          </Txt>
          <Txt size={12} color={colors.textFaint} numberOfLines={1}>
            {LIVE_P4_COPY.greenRoom} · لم يبدأ البث بعد
          </Txt>
        </View>
        <View
          style={{
            backgroundColor: colors.primaryTeal,
            borderRadius: radius.input,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
            {greenCta}
          </Txt>
        </View>
      </Pressable>
    );
  }

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
      <>
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
        {staffStart}
      </>
    );
  }

  return staffStart;
}

/** Staff only: a quiet outlined row — not a loud button on a student-facing page. */
function StartLiveCta({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={LIVE_P4_COPY.startLive}
      style={({ pressed }) => ({
        marginTop: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.borderSand2,
        paddingVertical: 12,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.8 : 1,
      })}
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
        <Feather name="mic" size={16} color={colors.primaryTeal} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14.5} weight="semibold" color={colors.primaryTeal} numberOfLines={1}>
          {LIVE_P4_COPY.startLive}
        </Txt>
        <Txt size={12} color={colors.textFaint} numberOfLines={1}>
          يُسجَّل ويُحفظ في هذا القسم
        </Txt>
      </View>
      <Feather name="chevron-left" size={18} color={colors.textGhost} />
    </Pressable>
  );
}
