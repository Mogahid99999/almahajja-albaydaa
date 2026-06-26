/**
 * Transport controls: back-10s · play/pause (78px brass) · forward-10s.
 * Feather icons for rotate arrows, Feather play/pause for center button.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { toArabicDigits } from '@/lib/format';
import { seekBy, toggle } from '@/lib/audioController';

type Props = {
  isPlaying: boolean;
};

export function TransportControls({ isPlaying }: Props) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
      }}
    >
      {/* Back 10s */}
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
          flexDirection: 'column',
          gap: 1,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="rotate-ccw" size={26} color={colors.onTealIcon} />
        <Txt size={9} color={colors.onTealSecondary} weight="semibold" align="center">
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

      {/* Forward 10s */}
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
          flexDirection: 'column',
          gap: 1,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="rotate-cw" size={26} color={colors.onTealIcon} />
        <Txt size={9} color={colors.onTealSecondary} weight="semibold" align="center">
          {toArabicDigits('10')}
        </Txt>
      </Pressable>
    </View>
  );
}
