/**
 * Transport controls: forward-10s · play/pause (78px brass) · back-10s.
 * Feather icons for rotate arrows, Feather play/pause for center button.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { toArabicDigits } from '@/lib/format';
import { playNext, playPrev, seekBy, toggle } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';

type Props = {
  isPlaying: boolean;
};

export function TransportControls({ isPlaying }: Props) {
  const hasNext = usePlayerStore((s) => s.nextLectureId !== null);
  const hasPrev = usePlayerStore((s) => s.prevLectureId !== null);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
      }}
    >
      {/* Previous lecture (RTL: sits on the right, opposite "next"). Dim when none. */}
      <Pressable
        onPress={() => playPrev()}
        disabled={!hasPrev}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="الدرس السابق"
        accessibilityState={{ disabled: !hasPrev }}
        style={({ pressed }) => ({
          width: 54,
          height: 54,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: !hasPrev ? 0.3 : pressed ? 0.6 : 1,
        })}
      >
        <Feather name="skip-forward" size={26} color={colors.onTealIcon} />
      </Pressable>

      {/* Forward 10s (swapped to this side — was back-10) */}
      <Pressable
        onPress={() => seekBy(10)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="تقدم ١٠ ثوانٍ"
        style={({ pressed }) => ({
          width: 54,
          height: 54,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="rotate-cw" size={26} color={colors.onTealIcon} />
        <Txt
          size={9}
          color={colors.onTealSecondary}
          weight="semibold"
          align="center"
          style={{ position: 'absolute', top: 36, width: 54 }}
        >
          {toArabicDigits('10')}
        </Txt>
      </Pressable>

      {/* Play / Pause */}
      <Pressable
        onPress={() => toggle()}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
        style={({ pressed }) => ({
          width: 78,
          height: 78,
          borderRadius: 39,
          backgroundColor: colors.accentBrass,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          ...shadows.button,
        })}
      >
        <Feather
          name={isPlaying ? 'pause' : 'play'}
          size={30}
          color={colors.primaryTealDeep}
        />
      </Pressable>

      {/* Back 10s (swapped to this side — was forward-10) */}
      <Pressable
        onPress={() => seekBy(-10)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="رجوع ١٠ ثوانٍ"
        style={({ pressed }) => ({
          width: 54,
          height: 54,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="rotate-ccw" size={26} color={colors.onTealIcon} />
        <Txt
          size={9}
          color={colors.onTealSecondary}
          weight="semibold"
          align="center"
          style={{ position: 'absolute', top: 36, width: 54 }}
        >
          {toArabicDigits('10')}
        </Txt>
      </Pressable>

      {/* Next lecture (RTL: skip points left — matches MiniPlayer's next button). Dim when there's no next. */}
      <Pressable
        onPress={() => playNext()}
        disabled={!hasNext}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="الدرس التالي"
        accessibilityState={{ disabled: !hasNext }}
        style={({ pressed }) => ({
          width: 54,
          height: 54,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: !hasNext ? 0.3 : pressed ? 0.6 : 1,
        })}
      >
        <Feather name="skip-back" size={26} color={colors.onTealIcon} />
      </Pressable>
    </View>
  );
}
