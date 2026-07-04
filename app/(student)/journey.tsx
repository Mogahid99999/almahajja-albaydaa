/**
 * رحلتي العلمية — personal learning journey (Phase 2 · feature C).
 *
 * Header: مداومة streak ring · weekly goal card · lifetime totals · earned/locked
 * badge seals. Strictly personal — no leaderboards, no comparison, no pressure
 * (CLAUDE.md calm tone). All figures come from server-side rollups via the api
 * layer; this screen only arranges them.
 *
 * Route: /(student)/journey  (linked from profile + a small Home card)
 */
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { GoalMetric } from '@/api/types';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBadges, useJourneySummary, useSetWeeklyGoal, useWeeklyGoal } from '@/hooks/useJourney';
import { useMyQuizStats } from '@/hooks/useQuizzes';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import { BadgeSeal } from '@/components/journey/BadgeSeal';
import { BuddyCompareCard } from '@/components/journey/BuddyCompareCard';
import { GoalCard } from '@/components/journey/GoalCard';
import { GoalEditorSheet } from '@/components/journey/GoalEditorSheet';
import { JourneyGate } from '@/components/journey/JourneyGate';
import { StreakDetailCard } from '@/components/journey/StreakDetailCard';
import { StreakRing } from '@/components/journey/StreakRing';

/** One lifetime-total stat tile. */
function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }}>
      <Txt weight="display" size={24} color={colors.primaryTeal} tabular align="center">
        {value}
      </Txt>
      <Txt size={11.5} color={colors.textMuted} align="center" style={{ marginTop: 4 }}>
        {label}
      </Txt>
    </Card>
  );
}

export default function JourneyScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: summary, isLoading } = useJourneySummary({ enabled: !isGuest });
  const { data: goal } = useWeeklyGoal({ enabled: !isGuest });
  const { data: badges } = useBadges({ enabled: !isGuest });
  const { data: quizStats } = useMyQuizStats({ enabled: !isGuest });
  const setGoal = useSetWeeklyGoal();

  const [editing, setEditing] = useState(false);

  const onSave = (metric: GoalMetric, target: number) => {
    setGoal.mutate({ metric, target }, { onSuccess: () => setEditing(false) });
  };

  return (
    <Screen bottomPad={118} padded>
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          رحلتي العلمية
        </Txt>
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : isLoading || !summary ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : (
        <>
          {/* ── Streak ring ──────────────────────────────────────────────────── */}
          <View style={{ alignItems: 'center', marginBottom: 22 }}>
            <StreakRing current={summary.streak.current} longest={summary.streak.longest} />
          </View>

          {/* ── Weekly goal ──────────────────────────────────────────────────── */}
          <View style={{ marginBottom: 16 }}>
            <GoalCard week={summary.week} onEdit={() => setEditing(true)} />
          </View>

          {/* ── Daily streak detail (26.1) ────────────────────────────────────── */}
          <View style={{ marginBottom: 16 }}>
            <StreakDetailCard />
          </View>

          {/* ── Buddy weekly comparison (26.2) — renders only with a buddy ────── */}
          <View style={{ marginBottom: 16 }}>
            <BuddyCompareCard week={summary.week} />
          </View>

          {/* ── Lifetime totals ──────────────────────────────────────────────── */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
            <StatCard value={arNum(summary.completedLectures)} label="دروس مكتملة" />
            <StatCard value={arNum(Math.round(summary.totalSeconds / 60))} label="دقائق الاستماع" />
            <StatCard value={arNum(summary.activeDays)} label="أيام النشاط" />
          </View>

          {/* ── Quizzes — quiet personal line (§12.4), only once one was taken ── */}
          {quizStats && quizStats.attempted > 0 ? (
            <Card
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 24,
              }}
            >
              <Txt size={13.5} weight="semibold" color={colors.textInk}>
                اختباراتك
              </Txt>
              <Txt size={12.5} color={colors.textMuted} tabular>
                {`أدّيت ${arNum(quizStats.attempted)} · اجتزت ${arNum(quizStats.passed)}`}
              </Txt>
            </Card>
          ) : null}

          {/* ── Badges ───────────────────────────────────────────────────────── */}
          <SectionTitle title="الأوسمة" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {(badges ?? []).map((b) => (
              <BadgeSeal key={b.key} badge={b} />
            ))}
          </View>
        </>
      )}

      {/* ── Goal editor sheet ──────────────────────────────────────────────── */}
      <GoalEditorSheet
        visible={editing}
        initial={goal ?? { metric: 'lectures', target: 3 }}
        saving={setGoal.isPending}
        onClose={() => setEditing(false)}
        onSave={onSave}
      />
    </Screen>
  );
}
