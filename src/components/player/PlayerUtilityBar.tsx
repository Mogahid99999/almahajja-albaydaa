/**
 * Bottom utility bar (absolute-positioned, 26px from bottom) — sits directly
 * under the lesson-tools row (ملاحظاتي · الفوائد · الأسئلة · تحميل) and
 * holds the playback-speed slider (see PlaybackRateSlider).
 */
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setRate } from '@/lib/audioController';
import { type PlaybackRate } from '@/stores/playerStore';
import { PlaybackRateSlider } from './PlaybackRateSlider';

type Props = {
  lectureId: string;
  rate: PlaybackRate;
};

export function PlayerUtilityBar({ lectureId, rate }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        // Sit above the system nav bar / gesture area (Issue 2).
        bottom: 26 + insets.bottom,
        alignItems: 'center',
      }}
    >
      <PlaybackRateSlider rate={rate} onCommit={(next) => setRate(next as PlaybackRate)} />
    </View>
  );
}
