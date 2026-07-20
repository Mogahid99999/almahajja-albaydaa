import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { BuddyGoal, BuddyGoalMetric } from '@/api/buddyGoals';
import type { BuddyStatus } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useMyBuddies } from '@/hooks/useBuddy';
import { useBuddyGoals, useCancelBuddyGoal, useCreateBuddyGoal } from '@/hooks/useBuddyGoals';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { CreateBuddyGoalSheet } from './CreateBuddyGoalSheet';
import { EncouragementSheet } from './EncouragementSheet';
import { formatBuddyGoalTarget, formatBuddySides } from './labels';

/** Days-left phrasing for a buddy goal. */
function daysLeftText(n: number): string {
  if (n <= 0) return 'انتهت المدة';
  if (n === 1) return 'آخر يوم';
  if (n === 2) return 'بقي يومان';
  return `بقي ${arNum(n)} أيام`;
}

/** One buddy card: shows the active/pending shared goal, or a create button. */
function BuddyCard({
  buddy,
  goal,
  onCreate,
  onEncourage,
  onCancelGoal,
}: {
  buddy: BuddyStatus;
  goal: BuddyGoal | undefined;
  onCreate: () => void;
  onEncourage: () => void;
  onCancelGoal: (goal: BuddyGoal) => void;
}) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt weight="semibold" size={15} color={colors.textInk}>
          {buddy.displayName}
        </Txt>
        <Pressable onPress={onEncourage} hitSlop={6} accessibilityRole="button" accessibilityLabel="تشجيع رفيقك">
          <Txt size={12} weight="medium" color={colors.accentBrassMuted}>
            تشجيع رفيقك
          </Txt>
        </Pressable>
      </View>

      {!goal ? (
        <>
          <Txt size={12.5} color={colors.textMuted}>
            لا يوجد هدف مشترك حاليًا
          </Txt>
          <Pressable
            onPress={onCreate}
            accessibilityRole="button"
            style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
          >
            <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
              إنشاء هدف رفقة
            </Txt>
          </Pressable>
        </>
      ) : goal.status === 'pending' ? (
        <View style={{ gap: 6 }}>
          <Txt size={12.5} color={colors.textMuted}>
            {goal.iCreated ? 'بانتظار قبول رفيقك' : 'دعاك رفيقك إلى هدف مشترك'}
          </Txt>
          <Txt size={12.5} weight="medium" color={colors.textInk} tabular>
            {formatBuddyGoalTarget(goal.target, goal.metric)}
          </Txt>
          <Pressable onPress={() => onCancelGoal(goal)} hitSlop={6} accessibilityRole="button">
            <Txt size={12} color={colors.stateDanger}>
              إلغاء
            </Txt>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Txt size={12.5} weight="medium" color={colors.textInk} tabular>
            {`هدفكما: ${formatBuddyGoalTarget(goal.target, goal.metric)}`}
          </Txt>
          <Txt size={12.5} color={colors.textMuted} tabular>
            {formatBuddySides(goal.myProgress, goal.buddyProgress, goal.target)}
          </Txt>
          <ProgressBar
            value={goal.target > 0 ? Math.min(1, goal.myProgress / goal.target) : 0}
            height={6}
            tint="teal"
          />
          {goal.status === 'completed' ? (
            <Txt size={12} color={colors.stateSuccess}>
              اكتمل هدف الرفقة — نفعكما الله بما تعلمتما
            </Txt>
          ) : goal.status === 'expired' ? (
            <Txt size={12} color={colors.textMuted}>
              انتهت مدة الهدف، وما أنجزتماه خطوة مباركة
            </Txt>
          ) : (
            <Txt size={12} color={colors.accentBrassMuted} tabular>
              {daysLeftText(goal.daysLeft)}
            </Txt>
          )}
        </View>
      )}
    </Card>
  );
}

/**
 * «رفقاء الرحلة» (V20 · §11) — a short card per accepted buddy showing the shared
 * goal (§10) or a create button. No standalone buddy page; this lives on رحلتي
 * العلمية. Renders nothing when the student has no accepted buddy.
 */
export function BuddyGoalsSection() {
  const router = useRouter();
  const { data: buddies } = useMyBuddies();
  const { data: goals } = useBuddyGoals();
  const createGoal = useCreateBuddyGoal();
  const cancelGoal = useCancelBuddyGoal();

  const [creatingFor, setCreatingFor] = useState<BuddyStatus | null>(null);
  const [encouragingFor, setEncouragingFor] = useState<BuddyStatus | null>(null);
  const [cancellingGoal, setCancellingGoal] = useState<BuddyGoal | null>(null);

  // Map each buddy to their single active/pending goal (at most one per §10).
  const goalByBuddy = useMemo(() => {
    const m = new Map<string, BuddyGoal>();
    for (const g of goals ?? []) {
      if (g.status === 'pending' || g.status === 'active') m.set(g.buddyId, g);
      else if (!m.has(g.buddyId)) m.set(g.buddyId, g); // fall back to latest terminal
    }
    return m;
  }, [goals]);

  if (!buddies || buddies.length === 0) return null;

  function onCreate(metric: BuddyGoalMetric, target: number, days: number) {
    if (!creatingFor) return;
    createGoal.mutate(
      { buddyId: creatingFor.buddyId, metric, target, days },
      { onSettled: () => setCreatingFor(null) },
    );
  }

  return (
    <View style={{ marginBottom: 8 }}>
      <SectionTitle
        title="رفقاء الرحلة"
        actionLabel="الدعوات"
        onAction={() => router.push('/(student)/buddy-requests')}
      />
      <View style={{ gap: 12 }}>
        {buddies.map((b) => (
          <BuddyCard
            key={b.buddyId}
            buddy={b}
            goal={goalByBuddy.get(b.buddyId)}
            onCreate={() => setCreatingFor(b)}
            onEncourage={() => setEncouragingFor(b)}
            onCancelGoal={setCancellingGoal}
          />
        ))}
      </View>

      <CreateBuddyGoalSheet
        visible={!!creatingFor}
        buddyName={creatingFor?.displayName ?? ''}
        saving={createGoal.isPending}
        onClose={() => setCreatingFor(null)}
        onCreate={onCreate}
      />

      <EncouragementSheet
        visible={!!encouragingFor}
        buddyId={encouragingFor?.buddyId ?? ''}
        buddyName={encouragingFor?.displayName ?? ''}
        onClose={() => setEncouragingFor(null)}
      />

      {/* Confirm before cancelling a buddy-goal invitation (mid-turn request). */}
      <ConfirmDialog
        visible={!!cancellingGoal}
        title="إلغاء هدف الرفقة"
        message="سيُلغى هذا الهدف المشترك. هل أنت متأكد؟"
        confirmLabel="إلغاء الهدف"
        cancelLabel="رجوع"
        pending={cancelGoal.isPending}
        onConfirm={() => {
          if (!cancellingGoal) return;
          cancelGoal.mutate(cancellingGoal.id, { onSettled: () => setCancellingGoal(null) });
        }}
        onCancel={() => setCancellingGoal(null)}
      />
    </View>
  );
}
