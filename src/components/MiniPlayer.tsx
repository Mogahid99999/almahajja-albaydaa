import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressBar, RhombusEmblem, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { toggle } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Fixed mini player, pinned above the bottom inset. Mounted once in the student
 * layout so it persists across Home ↔ Section. Tapping the body opens the full
 * player; the round brass button toggles play/pause (shared state — PRD §8).
 * Renders nothing until a lecture is loaded.
 */
export function MiniPlayer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentLectureId, title, isPlaying, positionSec, durationSec } =
    usePlayerStore();

  if (!currentLectureId) return null;
  const progress = durationSec > 0 ? positionSec / durationSec : 0;

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
          bottom: insets.bottom + 14,
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
        <ProgressBar
          value={progress}
          height={3}
          tint="onTeal"
          trackColor="rgba(223,231,227,0.22)"
        />
      </View>
      <Pressable
        onPress={toggle}
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
