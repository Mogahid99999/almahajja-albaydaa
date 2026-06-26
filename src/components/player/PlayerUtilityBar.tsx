/**
 * Bottom utility bar (absolute-positioned, 26px from bottom).
 * Three chips on rgba(255,255,255,0.07) rounded backgrounds:
 *   1. Speed chip — cycles PLAYBACK_RATES, displays in Arabic-Indic with ٫ decimal.
 *   2. Download chip — DownloadButton.
 *   3. Minimize icon — chevron-down → router.back().
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { Txt, IconButton } from '@/components/ui';
import { DownloadButton } from '@/components/DownloadButton';
import { toArabicDigits } from '@/lib/format';
import { setRate } from '@/lib/audioController';
import { PLAYBACK_RATES, type PlaybackRate } from '@/stores/playerStore';

const CHIP_BG = 'rgba(255,255,255,0.07)';
const CHIP_RADIUS = 14;
const CHIP_PADDING_V = 11;
const CHIP_PADDING_H = 15;

/** Format a PlaybackRate as Arabic-Indic with ٫ decimal, e.g. 0.75→"٠٫٧٥×", 1→"١٫٠×". */
function formatRate(rate: PlaybackRate): string {
  // Always show one decimal place.
  const str = rate.toFixed(1); // "0.75" | "1.0" | "1.25" | etc.
  return `${toArabicDigits(str.replace('.', '٫'))}×`;
}

type Props = {
  lectureId: string;
  rate: PlaybackRate;
};

export function PlayerUtilityBar({ lectureId, rate }: Props) {
  const router = useRouter();

  function cycleRate() {
    const idx = PLAYBACK_RATES.indexOf(rate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    setRate(next);
  }

  return (
    <View
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 26,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Speed chip */}
      <Pressable
        onPress={cycleRate}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`سرعة التشغيل ${formatRate(rate)}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: CHIP_BG,
          borderRadius: CHIP_RADIUS,
          paddingVertical: CHIP_PADDING_V,
          paddingHorizontal: CHIP_PADDING_H,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Feather name="clock" size={16} color={colors.accentBrass} />
        <Txt
          size={13}
          color={colors.onTealPrimary}
          weight="semibold"
          tabular
          style={{ minWidth: 30, textAlign: 'center' }}
        >
          {formatRate(rate)}
        </Txt>
      </Pressable>

      {/* Download chip */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: CHIP_BG,
          borderRadius: CHIP_RADIUS,
          paddingVertical: CHIP_PADDING_V,
          paddingHorizontal: CHIP_PADDING_H,
        }}
      >
        <DownloadButton lectureId={lectureId} onTeal size={17} />
        <Txt size={13} color={colors.onTealIcon} weight="medium">
          تحميل
        </Txt>
      </View>

      {/* Minimize — chevron-down → router.back() */}
      <Pressable
        onPress={() => router.back()}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="تصغير المشغل"
        style={({ pressed }) => ({
          width: 46,
          height: 46,
          backgroundColor: CHIP_BG,
          borderRadius: CHIP_RADIUS,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Feather name="chevron-down" size={18} color={colors.onTealIcon} />
      </Pressable>
    </View>
  );
}
