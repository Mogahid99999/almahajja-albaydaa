import { useEffect, useState } from 'react';
import { Modal, Pressable, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BuddyGoalMetric } from '@/api/buddyGoals';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { Txt } from '@/components/ui/Txt';
import { buddyMetricChoices, buddyMetricNoun } from './labels';

/** Target presets per metric. */
const PRESETS: Record<BuddyGoalMetric, number[]> = {
  lectures: [3, 5, 7, 10],
  minutes: [30, 60, 90, 120],
  active_days: [3, 5, 7],
};
const DAY_PRESETS = [3, 7, 14, 30];

/**
 * «إنشاء هدف رفقة» — the shared-goal creator (V20 · §10). Pick metric → value →
 * duration, then send. The buddy accepts or declines. Same calm sheet shell as
 * GoalEditorSheet; full RTL. The «هدف مشترك مع رفيقك» framing — never «عهد».
 */
export function CreateBuddyGoalSheet({
  visible,
  buddyName,
  saving,
  onClose,
  onCreate,
}: {
  visible: boolean;
  buddyName: string;
  saving: boolean;
  onClose: () => void;
  onCreate: (metric: BuddyGoalMetric, target: number, days: number) => void;
}) {
  const [metric, setMetric] = useState<BuddyGoalMetric>('lectures');
  const [target, setTarget] = useState(5);
  const [days, setDays] = useState(7);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setMetric('lectures');
      setTarget(5);
      setDays(7);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: 24 + insets.bottom,
            gap: 14,
          }}
        >
          <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderSand2 }} />

          <Txt weight="display" size={17} color={colors.primaryTeal} align="center">
            هدف مشترك مع رفيقك
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center">
            {buddyName}
          </Txt>

          {/* Metric */}
          <Chips
            label="نوع الهدف"
            options={buddyMetricChoices.map((c) => ({ key: c.metric, label: c.label }))}
            value={metric}
            onPick={(k) => {
              const m = k as BuddyGoalMetric;
              setMetric(m);
              setTarget(PRESETS[m][1] ?? PRESETS[m][0]);
            }}
          />

          {/* Target */}
          <Chips
            label={`القيمة (${buddyMetricNoun(metric, target)} لكل طالب)`}
            options={PRESETS[metric].map((n) => ({ key: String(n), label: arNum(n) }))}
            value={String(target)}
            onPick={(k) => setTarget(Number(k))}
          />

          {/* Duration */}
          <Chips
            label="المدة (أيام)"
            options={DAY_PRESETS.map((n) => ({ key: String(n), label: arNum(n) }))}
            value={String(days)}
            onPick={(k) => setDays(Number(k))}
          />

          <Pressable
            onPress={() => onCreate(metric, target, days)}
            disabled={saving}
            accessibilityRole="button"
            style={({ pressed }) =>
              ({
                marginTop: 4,
                paddingVertical: 14,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.primaryTeal,
                opacity: pressed || saving ? 0.6 : 1,
              }) as ViewStyle
            }
          >
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              {saving ? 'جارٍ الإرسال…' : 'إرسال الدعوة'}
            </Txt>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Chips({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onPick: (key: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt size={12.5} weight="medium" color={colors.textMuted}>
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const active = o.key === value;
          return (
            <Pressable
              key={o.key}
              onPress={() => onPick(o.key)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: radius.pill,
                backgroundColor: active ? colors.primaryTeal : colors.surfaceWhite,
                borderWidth: 1,
                borderColor: active ? colors.primaryTeal : colors.borderSand2,
              }}
            >
              <Txt size={13} weight="medium" color={active ? colors.onTealPrimary : colors.textInk} tabular>
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
