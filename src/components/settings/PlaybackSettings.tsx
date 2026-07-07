/**
 * Playback settings — التشغيل. One calm switch for "auto-advance to the next
 * lecture" (PRD §8). Persisted on-device via the settings store; read by the
 * audio controller when a lecture finishes. Same quiet styling as PrefsToggles.
 */
import { Switch, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import { useSettingsStore } from '@/stores/settingsStore';

import { Card } from '@/components/ui/Card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';

export function PlaybackSettings() {
  const autoAdvance = useSettingsStore((s) => s.autoAdvance);
  const setAutoAdvance = useSettingsStore((s) => s.setAutoAdvance);

  return (
    <View>
      <SectionTitle title="التشغيل" />
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 14,
            paddingHorizontal: 16,
            gap: 12,
          }}
        >
          <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="skip-back" size={15} color={colors.primaryTeal} />
          </View>

          <View style={{ flex: 1 }}>
            <Txt size={14} weight="medium" color={colors.textInk}>
              الانتقال التلقائي للدرس التالي
            </Txt>
            <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 2 }}>
              تشغيل الدرس التالي في القسم تلقائياً عند انتهاء الدرس الحالي
            </Txt>
          </View>

          <Switch
            value={autoAdvance}
            onValueChange={setAutoAdvance}
            trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
            thumbColor={colors.surfaceWhite}
            ios_backgroundColor={colors.surfaceInset}
          />
        </View>
      </Card>
    </View>
  );
}
