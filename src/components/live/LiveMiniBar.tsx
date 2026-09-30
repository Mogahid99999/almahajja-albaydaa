/**
 * The live variant of the MiniPlayer (PLAN_LIVE_V23 §7.3, prototype `DD.mini`):
 * rendered by `MiniPlayer` instead of the lecture bar while `liveStore.session`
 * is set. Same slot, same shape; RTL row = leave «×» · sheikh + speaker stack ·
 * «الحلقة · {title}» + who is speaking · pause/resume. Tap → back to the room.
 *
 * The host / a moderator: «×» opens the room on «مغادرة الحلقة» (hand over or
 * «إنهاء البث للجميع») instead of silently leaving — a host who left from here
 * used to walk out of a broadcast that kept running («لا يقفل معي»). After the
 * end (or a failed connection) «×» just dismisses the bar.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { BOTTOM_NAV_BAR_HEIGHT } from '@/components/navigation/BottomNavBar';
import { colors, radius, shadows } from '@/constants/theme';
import { useLiveStore } from '@/stores/liveStore';
import { LiveAvatar, LiveMarker, SheikhAvatar } from './LiveAvatar';
import {
  LIVE_COPY,
  NO_STAFF_NAMES,
  isModeratorRole,
  liveRoomHref,
  roleKind,
  sexOf,
  speakVerb,
  visibleName,
} from './liveUi';

export function LiveMiniBar({ liftAboveNavBar = false }: { liftAboveNavBar?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useLiveStore((s) => s.session);
  const conn = useLiveStore((s) => s.conn);
  const paused = useLiveStore((s) => s.paused);
  const people = useLiveStore((s) => s.people);
  const activeSpeakers = useLiveStore((s) => s.activeSpeakers);
  const setPaused = useLiveStore((s) => s.setPaused);
  const leave = useLiveStore((s) => s.leave);
  const myRole = useLiveStore((s) => s.me?.role ?? null);

  if (!session) return null;

  const sheikhName = session.sheikhName ?? '';
  const speakerId = activeSpeakers[0] ?? null;
  const speaker = speakerId ? people[speakerId] : undefined;
  const speakerIsHost = !!speaker && roleKind(speaker.role) === 'host';
  const bad = conn === 'reconnecting' || conn === 'offline' || conn === 'failed' || conn === 'connecting';

  let sub: string;
  let showMarker = false;
  if (conn === 'ended') sub = LIVE_COPY.ended;
  else if (conn === 'connecting') sub = LIVE_COPY.connecting;
  else if (conn === 'reconnecting') sub = LIVE_COPY.reconnecting;
  else if (conn === 'offline') sub = 'لا يوجد اتصال بالإنترنت';
  else if (conn === 'failed') sub = LIVE_COPY.failed;
  else if (conn === 'hostdrop') sub = 'ننتظر عودة الشيخ';
  else if (paused) sub = 'الاستماع متوقف مؤقتاً';
  else {
    showMarker = true;
    if (!speaker) sub = 'لا أحد يتحدث';
    else if (speaker.isMe) sub = 'أنت تتحدث';
    else {
      const name = speakerIsHost
        ? sheikhName || speaker.name
        : visibleName(speakerId!, speaker, false, NO_STAFF_NAMES);
      sub = `${speakVerb(sexOf(speaker.gender))} ${name}`;
    }
  }
  const ringSheikh = speakerIsHost && !paused && !bad;

  return (
    <Pressable
      onPress={() => router.push(liveRoomHref(session.id))}
      accessibilityRole="button"
      accessibilityLabel={`${LIVE_COPY.backToRoom}: ${session.title}`}
      style={[
        {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: liftAboveNavBar ? insets.bottom + BOTTOM_NAV_BAR_HEIGHT + 10 : insets.bottom + 14,
          backgroundColor: colors.primaryTealDeep,
          borderRadius: radius.feature - 2,
          padding: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        shadows.miniPlayer,
      ]}
    >
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          if (isModeratorRole(myRole) && conn !== 'ended' && conn !== 'failed') {
            router.push(liveRoomHref(session.id, { end: true }));
            return;
          }
          void Promise.resolve(leave()).catch(() => {});
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={LIVE_COPY.leave}
        style={{ width: 28, height: 28, marginEnd: -6, alignItems: 'center', justifyContent: 'center' }}
      >
        <Feather name="x" size={16} color={colors.onTealSecondary} />
      </Pressable>

      {/* Sheikh + the current speaker (when it isn't the sheikh). */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            borderRadius: 21,
            borderWidth: 2,
            borderColor: ringSheikh ? colors.accentBrass : colors.primaryTealDeep,
          }}
        >
          <SheikhAvatar name={sheikhName} size={38} />
        </View>
        {speaker && !speakerIsHost && !paused && !bad ? (
          <View
            style={{
              marginStart: -11,
              borderRadius: 17,
              borderWidth: 2,
              borderColor: colors.accentBrass,
            }}
          >
            <LiveAvatar gender={sexOf(speaker.gender)} size={30} me={!!speaker.isMe} />
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt weight="display" size={14} color={colors.onTealPrimary} numberOfLines={1}>
          {`الحلقة · ${session.title}`}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {showMarker ? <LiveMarker onTeal size={7} /> : null}
          <Txt size={11.5} color={colors.onTealSecondary} numberOfLines={1} style={{ flexShrink: 1 }}>
            {sub}
          </Txt>
        </View>
      </View>

      {conn !== 'ended' ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            setPaused(!paused);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'استئناف الاستماع' : 'إيقاف مؤقت'}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.accentBrass,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name={paused ? 'play' : 'pause'} size={17} color={colors.primaryTealDeep} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
