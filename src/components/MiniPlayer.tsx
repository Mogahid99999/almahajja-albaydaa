import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressBar, RhombusEmblem, Txt } from '@/components/ui';
import { BOTTOM_NAV_BAR_HEIGHT } from '@/components/navigation/BottomNavBar';
import { colors, radius, shadows } from '@/constants/theme';
import { playNext, stop, toggle } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Fixed mini player, pinned above the bottom inset. Mounted once in the student
 * layout so it persists across Home ↔ Section. Tapping the body opens the full
 * player; the round brass button toggles play/pause (shared state — PRD §8).
 * Renders nothing until a lecture is loaded.
 */
export function MiniPlayer({ liftAboveNavBar = false }: { liftAboveNavBar?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentLectureId = usePlayerStore((s) => s.currentLectureId);
  const title = usePlayerStore((s) => s.title);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const nextLectureId = usePlayerStore((s) => s.nextLectureId);

  if (!currentLectureId) return null;

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/player/[id]', params: { id: currentLectureId } })
      }
      style={[
        {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: liftAboveNavBar
            ? insets.bottom + BOTTOM_NAV_BAR_HEIGHT + 10
            : insets.bottom + 14,
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
          stop();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="إغلاق المشغل"
        style={{
          width: 28,
          height: 28,
          marginEnd: -6,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="x" size={16} color={colors.onTealSecondary} />
      </Pressable>
      <RhombusEmblem size={40} radius={12} />
      <View style={{ flex: 1, gap: 6 }}>
        <Txt
          weight="display"
          size={14}
          color={colors.onTealPrimary}
          numberOfLines={1}
        >
          {title}
        </Txt>
        <MiniPlayerProgress />
      </View>
      {nextLectureId ? (
        <Pressable
          onPress={(e) => {
            // Don't let the tap bubble up to the card (which opens the player).
            e.stopPropagation?.();
            playNext();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="الدرس التالي"
          style={{
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* RTL: "next" skips left. */}
          <Feather name="skip-back" size={18} color={colors.onTealSecondary} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          toggle();
        }}
        hitSlop={10}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.accentBrass,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather
          name={isPlaying ? 'pause' : 'play'}
          size={18}
          color={colors.primaryTealDeep}
        />
      </Pressable>
    </Pressable>
  );
}

/** Isolated so the position tick only re-renders this bar, not title/buttons/artwork. */
function MiniPlayerProgress() {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const progress = durationSec > 0 ? positionSec / durationSec : 0;
  return (
    <ProgressBar value={progress} height={3} tint="onTeal" trackColor="rgba(223,231,227,0.22)" />
  );
}
