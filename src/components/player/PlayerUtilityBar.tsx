/**
 * Bottom utility bar (absolute-positioned, 26px from bottom) — sits directly
 * under the lesson-tools row (ملاحظاتي · الفوائد · الأسئلة · تحميل) and
 * holds the playback-speed button (see PlaybackRateButton).
 */
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setRate } from '@/lib/audioController';
import { type PlaybackRate } from '@/stores/playerStore';
import { PlaybackRateButton } from './PlaybackRateButton';

type Props = {
  lectureId: string;
  rate: PlaybackRate;
  /** Base bottom offset — the player shrinks it on short viewports. */
  bottom?: number;
};

export function PlayerUtilityBar({ lectureId, rate, bottom = 26 }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        // Sit above the system nav bar / gesture area (Issue 2).
        bottom: bottom + insets.bottom,
        alignItems: 'center',
      }}
    >
      <PlaybackRateButton rate={rate} onChange={(next) => setRate(next as PlaybackRate)} />
    </View>
  );
}
