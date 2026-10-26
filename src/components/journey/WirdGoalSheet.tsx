import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { SheetModal } from '@/components/ui/SheetModal';
import { Txt } from '@/components/ui/Txt';
import { WIRD_MAX, WIRD_MIN, WIRD_PRESETS, parseWirdGoal } from '@/mushaf/wird';

const pagesLabel = (n: number) =>
  n === 1 ? 'صفحة' : n === 2 ? 'صفحتان' : n <= 10 ? `${arNum(n)} صفحات` : `${arNum(n)} صفحة`;

/**
 * «ورد القرآن اليومي» — pick the pages a day (presets or a custom number), or
 * «بدون هدف يومي». Same calm sheet as the weekly goal editor.
 */
export function WirdGoalSheet({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: number | null;
  onClose: () => void;
  onSave: (goal: number | null) => void;
}) {
  // Edge-to-edge: keep the last link («بدون هدف يومي») above the system nav bar.
  const bottom = useSafeAreaInsets().bottom;
  const isPreset = (n: number | null) => n != null && (WIRD_PRESETS as readonly number[]).includes(n);
  const [goal, setGoal] = useState<number | null>(initial ?? 5);
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!visible) return;
    const g = initial ?? 5;
    setGoal(g);
    setCustom(!isPreset(g));
    setText(isPreset(g) ? '' : arNum(g));
  }, [visible, initial]);

  const customGoal = custom ? parseWirdGoal(text) : null;
  const chosen = custom ? customGoal : goal;

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}
        behavior="padding"
        pointerEvents="box-none"
      >
        <Pressable onPress={() => {}} style={[styles.sheet, { paddingBottom: 34 + bottom }]}>
          <View style={styles.grab} />
          <View style={{ gap: 6 }}>
            <Txt weight="display" size={20} color={colors.primaryTeal} align="center">
              ورد القرآن اليومي
            </Txt>
            <Txt size={12.5} color={colors.textMuted} align="center">
              كم صفحة تحبّ أن تقرأ كل يوم؟ تبدأ من حيث شئت في المصحف.
            </Txt>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {WIRD_PRESETS.map((n) => {
              const active = !custom && goal === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    setCustom(false);
                    setGoal(n);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipOn]}
                >
                  <Txt size={14} weight="semibold" color={active ? colors.primaryTealDeep : colors.textSlate}>
                    {pagesLabel(n)}
                  </Txt>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setCustom(true)}
              accessibilityRole="button"
              accessibilityState={{ selected: custom }}
              style={[styles.chip, styles.chipWide, custom && styles.chipOn]}
            >
              {/* A definite width: a fit-content box mis-measures this two-word
                  label under forced RTL and clips «آخر» once selected. */}
              <Txt
                size={14}
                weight="semibold"
                align="center"
                numberOfLines={1}
                style={{ alignSelf: 'stretch' }}
                color={custom ? colors.primaryTealDeep : colors.textSlate}
              >
                عدد آخر
              </Txt>
            </Pressable>
          </View>

          {custom ? (
            <View style={{ gap: 6 }}>
              <View style={styles.customRow}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  keyboardType="number-pad"
                  maxLength={3}
                  autoFocus
                  placeholder={arNum(3)}
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="عدد الصفحات في اليوم"
                  style={styles.input}
                />
                <Txt size={14} color={colors.textSlate}>صفحة في اليوم</Txt>
              </View>
              <Txt size={11.5} color={text && !customGoal ? colors.stateDanger : colors.textGhost} align="center">
                {`من ${arNum(WIRD_MIN)} إلى ${arNum(WIRD_MAX)} صفحة`}
              </Txt>
            </View>
          ) : null}

          <Pressable
            onPress={() => chosen != null && onSave(chosen)}
            disabled={chosen == null}
            accessibilityRole="button"
            style={({ pressed }) => [styles.save, { opacity: chosen == null ? 0.45 : pressed ? 0.75 : 1 }]}
          >
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              {chosen != null ? `اعتمد ${pagesLabel(chosen)} يومياً` : 'اختر عدد الصفحات'}
            </Txt>
          </Pressable>
          <Pressable onPress={() => onSave(null)} accessibilityRole="button" hitSlop={6} style={{ alignItems: 'center' }}>
            <Txt size={13} weight="medium" color={colors.accentBrassMuted}>
              بدون هدف يومي — أقرأ دون تتبّع
            </Txt>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </SheetModal>
  );
}

export { pagesLabel };

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bgSandRaised,
    borderTopLeftRadius: radius.artwork,
    borderTopRightRadius: radius.artwork,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderSand2 },
  chip: {
    minWidth: 72,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand2,
  },
  chipOn: { backgroundColor: colors.accentBrass, borderColor: colors.accentBrass },
  chipWide: { width: 104 },
  customRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  input: {
    width: 84,
    paddingVertical: 9,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceCard,
    textAlign: 'center',
    fontSize: 18,
    color: colors.textInk,
  },
  save: { paddingVertical: 14, borderRadius: radius.input, alignItems: 'center', backgroundColor: colors.primaryTeal },
});
