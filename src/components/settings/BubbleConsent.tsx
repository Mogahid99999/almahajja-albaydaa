/**
 * Floating-bubble consent — التذكير العائم (PLAN_V3 Phase 9, experimental).
 *
 * The master opt-in for the resume-nudge overlay. Hidden entirely until the
 * native overlay module is linked (`bubbleSupported()`), so it never appears in
 * a build where the feature can't work. Turning it on also opens the system
 * "draw over other apps" toggle (SYSTEM_ALERT_WINDOW can't be granted silently).
 * Same calm styling as PlaybackSettings / PrefsToggles.
 */
import { Switch, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import { useSettingsStore } from '@/stores/settingsStore';
import { bubbleSupported, requestOverlayPermission } from '@/lib/bubble';

import { Card } from '@/components/ui/Card';
import { Rhombus } from '@/components/ui/Rhombus';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';

export function BubbleConsent() {
  const bubbleConsent = useSettingsStore((s) => s.bubbleConsent);
  const setBubbleConsent = useSettingsStore((s) => s.setBubbleConsent);

  // Hidden until the native overlay module is linked (experimental, Android-only).
  if (!bubbleSupported()) return null;

  const onToggle = (next: boolean) => {
    setBubbleConsent(next);
    if (next) void requestOverlayPermission(); // opens the system overlay toggle
  };

  return (
    <View>
      <SectionTitle title="التذكير العائم" />
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
            <Rhombus size={30} color="rgba(31,74,66,0.08)" />
            <View style={{ position: 'absolute' }}>
              <Feather name="bell" size={15} color={colors.primaryTeal} />
            </View>
          </View>

          <View style={{ flex: 1 }}>
            <Txt size={14} weight="medium" color={colors.textInk}>
              تذكير عائم لمتابعة الدرس
            </Txt>
            <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 2 }}>
              فقاعة لطيفة تظهر فوق التطبيقات لتذكيرك بإكمال درسك (تتطلب إذن الظهور فوق التطبيقات)
            </Txt>
          </View>

          <Switch
            value={bubbleConsent}
            onValueChange={onToggle}
            trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
            thumbColor={colors.surfaceWhite}
            ios_backgroundColor={colors.surfaceInset}
          />
        </View>
      </Card>
    </View>
  );
}
