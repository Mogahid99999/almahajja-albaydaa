import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import type { GoalMetric, WeeklyGoal } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { Txt } from '@/components/ui/Txt';
import { defaultTarget, metricChoices, metricNoun, targetPresets } from './labels';

/**
 * Bottom-sheet editor for the weekly goal (Phase 2 · feature C): pick the metric
 * (دروس / دقائق) and a target. Calm, low-chrome — preset chips, no spinners or
 * pressure. Seeds from the current goal each time it opens.
 */
export function GoalEditorSheet({
  visible,
  initial,
  saving = false,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: WeeklyGoal;
  saving?: boolean;
  onClose: () => void;
  onSave: (metric: GoalMetric, target: number) => void;
}) {
  const [metric, setMetric] = useState<GoalMetric>(initial.metric);
  const [target, setTarget] = useState<number>(initial.target);

  // Re-seed from the live goal whenever the sheet opens.
  useEffect(() => {
    if (visible) {
      setMetric(initial.metric);
      setTarget(initial.target);
    }
  }, [visible, initial.metric, initial.target]);

  const pickMetric = (next: GoalMetric) => {
    setMetric(next);
    // Snap target onto the new metric's presets if the old value doesn't fit.
    if (!targetPresets[next].includes(target)) setTarget(defaultTarget[next]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop */}
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}
      >
        {/* Sheet — stop propagation so taps inside don't dismiss */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: 34,
            gap: 18,
          }}
        >
          {/* Grab handle */}
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.borderSand2,
            }}
          />

          <Txt weight="display" size={20} color={colors.primaryTeal} align="center">
            هدف الأسبوع
          </Txt>

          {/* Metric toggle */}
          <View>
            <Txt size={13} color={colors.textMuted} style={{ marginBottom: 8 }}>
              المقياس
            </Txt>
            <View
              style={{
                flexDirection: 'row',
                gap: 10,
              }}
            >
              {metricChoices.map((c) => {
                const active = c.metric === metric;
                return (
                  <Pressable
                    key={c.metric}
                    onPress={() => pickMetric(c.metric)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      flex: 1,
                      paddingVertical: 11,
                      borderRadius: radius.input,
                      alignItems: 'center',
                      backgroundColor: active ? colors.primaryTeal : colors.surfaceCard,
                      borderWidth: 1,
                      borderColor: active ? colors.primaryTeal : colors.borderSand2,
                    }}
                  >
                    <Txt
                      size={14}
                      weight="medium"
                      color={active ? colors.onTealPrimary : colors.textSlate}
                    >
                      {c.label}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Target presets */}
          <View>
            <Txt size={13} color={colors.textMuted} style={{ marginBottom: 8 }}>
              {`المقدار (${metricNoun(metric)} في الأسبوع)`}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {targetPresets[metric].map((value) => {
                const active = value === target;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setTarget(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      minWidth: 64,
                      paddingVertical: 10,
                      paddingHorizontal: 16,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      backgroundColor: active ? colors.accentBrass : colors.surfaceCard,
                      borderWidth: 1,
                      borderColor: active ? colors.accentBrass : colors.borderSand2,
                    }}
                  >
                    <Txt
                      size={15}
                      weight="semibold"
                      tabular
                      color={active ? colors.primaryTealDeep : colors.textSlate}
                    >
                      {arNum(value)}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Save */}
          <Pressable
            onPress={() => onSave(metric, target)}
            disabled={saving}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 4,
              paddingVertical: 14,
              borderRadius: radius.input,
              alignItems: 'center',
              backgroundColor: colors.primaryTeal,
              opacity: pressed || saving ? 0.7 : 1,
            })}
          >
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ الهدف'}
            </Txt>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
