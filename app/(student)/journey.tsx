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
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { GoalMetric } from '@/api/types';
import { nearestBadge } from '@/constants/badges';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useBadges,
  useJourneyMap,
  useJourneySummary,
  useSetWeeklyGoal,
  useSyncBadgesOnMount,
  useWeeklyGoal,
} from '@/hooks/useJourney';
import { useMyQuizStats } from '@/hooks/useQuizzes';
import { useResumeCard } from '@/hooks/useProgress';
import { useUnreviewedBookmarkCount } from '@/hooks/useBookmarks';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useRefreshAll } from '@/hooks/useRefreshAll';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import { BadgeSeal } from '@/components/journey/BadgeSeal';
import { BuddyGoalsSection } from '@/components/journey/BuddyGoalsSection';
import { GoalCard } from '@/components/journey/GoalCard';
import { GoalEditorSheet } from '@/components/journey/GoalEditorSheet';
import { JourneyGate } from '@/components/journey/JourneyGate';
import { ResumeCard } from '@/components/journey/ResumeCard';
import { JourneyMap } from '@/components/journey/JourneyMap';
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
  const { data: summary, isLoading, refetch: refetchSummary } = useJourneySummary({ enabled: !isGuest });
  const { data: goal, refetch: refetchGoal } = useWeeklyGoal({ enabled: !isGuest });
  const { data: badges, refetch: refetchBadges } = useBadges({ enabled: !isGuest });
  const { data: quizStats, refetch: refetchQuizStats } = useMyQuizStats({ enabled: !isGuest });
  const { data: resumeCard, refetch: refetchResume } = useResumeCard({ enabled: !isGuest });
  const pendingBookmarks = useUnreviewedBookmarkCount({ enabled: !isGuest });
  const { data: journeyMap } = useJourneyMap({ enabled: !isGuest });
  const setGoal = useSetWeeklyGoal();
  const miniPad = useMiniPlayerPad();
  // Pull-to-refresh refreshes everything server-side (incl. shared app-config
  // and the buddy card) via refreshAll; the registered-only journey queries are
  // additionally refetched so the spinner waits on the page's own data.
  const refreshAll = useRefreshAll();
  const { refreshing, onRefresh } = usePullToRefresh(
    isGuest
      ? [refreshAll]
      : [refetchSummary, refetchGoal, refetchBadges, refetchQuizStats, refetchResume, refreshAll],
  );

  // Catch up any badge earned offline / via the streak crons, once on mount.
  useSyncBadgesOnMount(!isGuest);

  const [editing, setEditing] = useState(false);

  // On the journey page show a compact preview (§16.9): earned seals first, then
  // the nearest locked one as a teaser — the full tabbed grid lives on /badges.
  const journeyBadges = useMemo(() => {
    const list = badges ?? [];
    const earned = list.filter((b) => b.earned);
    const near = nearestBadge(list);
    const preview = near ? [...earned, near] : earned;
    return preview.slice(0, 6);
  }, [badges]);

  const onSave = (metric: GoalMetric, target: number) => {
    // Close on settle (not just success) so an offline edit — which resolves via
    // the outbox — still closes the sheet normally; the value is already optimistic.
    setGoal.mutate({ metric, target }, { onSettled: () => setEditing(false) });
  };

  return (
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginBottom: 22,
        }}
      >
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          رحلتي العلمية
        </Txt>
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : isLoading || !summary ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : (
        <>
          {/* ── Streak ring — tap opens سجل النشاط (§2) ───────────────────────── */}
          <Pressable
            onPress={() => router.push('/(student)/activity')}
            accessibilityRole="button"
            accessibilityLabel="عرض سجل النشاط"
            style={({ pressed }) => ({ alignItems: 'center', marginBottom: 22, opacity: pressed ? 0.85 : 1 })}
          >
            <StreakRing current={summary.streak.current} longest={summary.streak.longest} />
          </Pressable>

          {/* ── واصل رحلتك — resume card (§3) ─────────────────────────────────── */}
          {resumeCard ? (
            <View style={{ marginBottom: 16 }}>
              <ResumeCard data={resumeCard} />
            </View>
          ) : null}

          {/* ── «للمراجعة لاحقًا» shortcut (§4) — only with pending marks ──────── */}
          {pendingBookmarks > 0 ? (
            <Pressable
              onPress={() => router.push('/(student)/bookmarks')}
              accessibilityRole="button"
              style={({ pressed }) => ({ marginBottom: 16, opacity: pressed ? 0.85 : 1 })}
            >
              <Card
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Txt size={13.5} color={colors.textInk} tabular>
                  {`لديك ${arNum(pendingBookmarks)} مواضع بانتظار المراجعة`}
                </Txt>
                <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
                  ابدأ المراجعة
                </Txt>
              </Card>
            </Pressable>
          ) : null}

          {/* ── Weekly goal ──────────────────────────────────────────────────── */}
          <View style={{ marginBottom: 16 }}>
            <GoalCard week={summary.week} onEdit={() => setEditing(true)} />
          </View>

          {/* ── Daily streak detail (26.1) ────────────────────────────────────── */}
          <View style={{ marginBottom: 16 }}>
            <StreakDetailCard />
          </View>

          {/* ── خريطة رحلتي — journey map (§6): top few + full link ────────────── */}
          {journeyMap && journeyMap.length > 0 ? (
            <View style={{ marginBottom: 8 }}>
              <SectionTitle
                title="خريطة رحلتي"
                actionLabel={journeyMap.length > 3 ? 'عرض الرحلة كاملة' : undefined}
                onAction={
                  journeyMap.length > 3
                    ? () => router.push('/(student)/journey-map')
                    : undefined
                }
              />
              <JourneyMap entries={journeyMap} limit={3} />
              <View style={{ marginBottom: 16 }} />
            </View>
          ) : null}

          {/* ── حصاد الرحلة — top 3 + full link (§8) ──────────────────────────── */}
          <SectionTitle
            title="حصاد الرحلة"
            actionLabel="عرض الحصاد كاملًا"
            onAction={() => router.push('/(student)/harvest')}
          />
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
            <StatCard value={arNum(summary.completedLectures)} label="دروس مكتملة" />
            <StatCard value={arNum(Math.round(summary.totalSeconds / 3600))} label="ساعات الاستماع" />
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

          {/* ── Badges — nearest few + a link to the full page (§16.9) ────────── */}
          <SectionTitle
            title="الأوسمة"
            actionLabel="عرض الكل"
            onAction={() => router.push('/(student)/badges')}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
            {journeyBadges.map((b) => (
              <BadgeSeal key={b.key} badge={b} />
            ))}
          </View>

          {/* ── رفقاء الرحلة — buddy shared goals (§11) — only with a buddy ────── */}
          <BuddyGoalsSection />
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
