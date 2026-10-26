import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';

import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';
import { openMushafReader } from '@/mushaf/open';
import { useWirdToday } from '@/mushaf/useWirdToday';
import { useWirdStore } from '@/mushaf/wird';

import { WirdGoalSheet, pagesLabel } from './WirdGoalSheet';

/**
 * «وردك اليومي» on رحلتي العلمية: today's pages toward the daily goal and one
 * button that opens the mushaf where the reader stopped. Before a choice it
 * offers the setup; with «بدون هدف يومي» it shrinks to one quiet line.
 */
export function WirdCard() {
  const router = useRouter();
  const { goal, count, done, configured } = useWirdToday();
  const setGoal = useWirdStore((s) => s.setGoal);
  const [editing, setEditing] = useState(false);

  const open = () => openMushafReader(router);
  const save = (g: number | null) => {
    setGoal(g);
    setEditing(false);
  };

  const sheet = <WirdGoalSheet visible={editing} initial={goal} onClose={() => setEditing(false)} onSave={save} />;

  if (!configured) {
    return (
      <Card style={{ gap: 10 }}>
        <Txt weight="semibold" size={15} color={colors.textInk}>
          ورد القرآن اليومي 📖
        </Txt>
        <Txt size={13} color={colors.textMuted}>
          حدّد صفحات تقرؤها كل يوم من المصحف، ويُحسب وردك ضمن رحلتك اليومية.
        </Txt>
        <Pressable
          onPress={() => setEditing(true)}
          accessibilityRole="button"
          style={({ pressed }) => [btn, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
            حدّد وردك
          </Txt>
        </Pressable>
        {sheet}
      </Card>
    );
  }

  if (goal == null) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Pressable onPress={open} accessibilityRole="button" hitSlop={6} style={{ flex: 1 }}>
          <Txt size={13.5} color={colors.textInk}>المصحف · بلا ورد يومي</Txt>
        </Pressable>
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
          <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
            حدّد ورداً
          </Txt>
        </Pressable>
        {sheet}
      </Card>
    );
  }

  const shown = Math.min(count, goal);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt weight="semibold" size={15} color={colors.textInk}>
          وردك اليومي 📖
        </Txt>
        <Pressable
          onPress={() => setEditing(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="تعديل الورد اليومي"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Feather name="edit-2" size={13} color={colors.accentBrassMuted} />
          <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
            تعديل
          </Txt>
        </Pressable>
      </View>

      {done ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Txt size={14} weight="semibold" color={colors.stateSuccess}>
            أتممت وردك اليومي 🤍
          </Txt>
          <Txt size={12.5} color={colors.textMuted}>
            تقبّل الله منك وزادك علماً وهدى.
          </Txt>
        </View>
      ) : (
        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt size={13} color={colors.textMuted}>{`اقرأ ${pagesLabel(goal)} اليوم`}</Txt>
          <Txt size={13} weight="semibold" color={colors.primaryTeal600} tabular>
            {`${arNum(shown)} من ${arNum(goal)}`}
          </Txt>
        </View>
      )}

      <ProgressBar value={goal ? shown / goal : 0} style={{ marginTop: 12 }} />

      <Pressable
        onPress={open}
        accessibilityRole="button"
        style={({ pressed }) => [done ? btnQuiet : btn, { marginTop: 14, opacity: pressed ? 0.8 : 1 }]}
      >
        <Txt size={14} weight="semibold" color={done ? colors.primaryTeal : colors.onTealPrimary}>
          {done ? 'متابعة القراءة' : count > 0 ? 'تابع وردك' : 'ابدأ وردك'}
        </Txt>
      </Pressable>
      {sheet}
    </Card>
  );
}

const btn = {
  paddingVertical: 12,
  borderRadius: radius.input,
  alignItems: 'center' as const,
  backgroundColor: colors.primaryTeal,
};
const btnQuiet = {
  paddingVertical: 11,
  borderRadius: radius.input,
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceInset,
};
