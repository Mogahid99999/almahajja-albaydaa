import { ActivityIndicator, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { useHome } from '@/hooks/useSections';
import { useLiveNow } from '@/hooks/useLive';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useRefreshAll } from '@/hooks/useRefreshAll';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Screen } from '@/components/ui';
import { BroadcastCard } from '@/components/home/BroadcastCard';
import { ContinueCard } from '@/components/home/ContinueCard';
import { DuaCard } from '@/components/home/DuaCard';
import { GuestBanner } from '@/components/home/GuestBanner';
import { HomeHeader } from '@/components/home/HomeHeader';
import { NewlyAddedRail } from '@/components/home/NewlyAddedRail';
import { FeaturedRail } from '@/components/home/FeaturedRail';
import { BuddyCard } from '@/components/home/BuddyCard';
import { BuddyGoalInvitesCard } from '@/components/home/BuddyGoalInvitesCard';
import { QuestionsHomeCard } from '@/components/home/QuestionsHomeCard';
import { SectionsGrid } from '@/components/home/SectionsGrid';
import { StreakCard } from '@/components/home/StreakCard';
import { JourneyHomeCard } from '@/components/journey/JourneyHomeCard';
import { LiveHomeCard } from '@/components/live/LiveHomeCard';
import { LiveUpcomingCard } from '@/components/live/LiveUpcomingCard';
import { useLiveHomeSlot } from '@/components/live/useLiveHomeSlot';
import { SupportContactLink } from '@/components/SupportContactLink';
import { ScheduleTodayCard } from '@/components/home/ScheduleTodayCard';

/**
 * Home — student landing screen.
 * Reference: screens/رواق العلم.dc.html
 * Layout (top → bottom):
 *   HomeHeader (fixed) · LiveHomeCard | ContinueCard · NewlyAddedRail · FeaturedRail · SectionsGrid · DuaCard
 *
 * HomeHeader is rendered OUTSIDE the scrolling <Screen> so it stays pinned
 * while the rest of the page scrolls beneath it (Telegram/WhatsApp-style
 * fixed top bar) — Screen gets `topInset={false}` so it doesn't also pad for
 * the status bar the header already accounts for.
 *
 * 118px bottom padding clears the globally-mounted MiniPlayer.
 * The MiniPlayer is NOT added here — it lives in the student group layout.
 */
export default function HomeScreen() {
  const { data, isLoading } = useHome();
  // «مباشر الآن» takes the ContinueCard slot while a live is on (V23 §7.3) —
  // and gives it back the moment this device knows it ended (useLiveHomeSlot:
  // the server's «live» can lag the room's end by a poll).
  const { data: liveNow } = useLiveNow();
  const live = useLiveHomeSlot(liveNow);
  const upcoming = live ? [] : (liveNow?.upcoming ?? []);
  const miniPad = useMiniPlayerPad();
  // Pull-to-refresh refreshes EVERYTHING the server can change — sections, the
  // buddy card, broadcasts, notifications AND the shared app-config values (the
  // support link, About/Q&A/share copy, etc). Anything editable from the admin
  // panel now updates on pull without a full app restart. See useRefreshAll.
  const refreshAll = useRefreshAll();
  const { refreshing, onRefresh } = usePullToRefresh([refreshAll]);

  if (isLoading && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgSand, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primaryTeal} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgSand }}>
      <HomeHeader />

      <Screen
        bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
        padded={false}
        topInset={false}
        contentStyle={{ paddingTop: 18 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {/* Gentle, dismissible register nudge (guests only) */}
        <View style={{ paddingHorizontal: spacing.screenH }}>
          <GuestBanner />
        </View>

        {/* تذكير نافع — active admin broadcast (1-day window, dismissible) */}
        <View style={{ paddingHorizontal: spacing.screenH }}>
          <BroadcastCard />
        </View>

        {/* Next scheduled live(s) — «ذكّرني» arrives with P5 notifications */}
        {upcoming.length > 0 ? (
          <View style={{ paddingHorizontal: spacing.screenH, marginBottom: 12 }}>
            <LiveUpcomingCard sessions={upcoming} remindedIds={liveNow?.remindedIds} />
          </View>
        ) : null}

        {/* مباشر الآن, else continue listening — full width, own trailing gap before the rail below */}
        {live ? (
          <View style={{ paddingHorizontal: spacing.screenH, marginBottom: 28 }}>
            <LiveHomeCard session={live} />
          </View>
        ) : data?.continueListening ? (
          <View style={{ paddingHorizontal: spacing.screenH, marginBottom: 28 }}>
            <ContinueCard continueListening={data.continueListening} />
          </View>
        ) : null}

        {/* دروس اليوم — the weekly schedule (0158); hides itself when empty */}
        <ScheduleTodayCard
          liveSectionId={live?.sectionId ?? null}
          containerStyle={{ paddingHorizontal: spacing.screenH, marginBottom: 28 }}
        />

        {/* أُضيف حديثاً — newest published, auto-sorted (first) */}
        <NewlyAddedRail lectures={data?.newlyAdded ?? []} />

        {/* مختارات — staff-curated horizontal rail (second) */}
        <FeaturedRail lectures={data?.featured ?? []} />

        {/* Sections grid — 22px padding. Top margin keeps the rail above's
            pagination dots from sitting flush against the first card. */}
        <View style={{ paddingHorizontal: spacing.screenH, marginTop: 12 }}>
          {/* المداومة اليومية — quiet streak state (registered users only) */}
          <StreakCard />

          {/* رفيق الدراسة — invitation / today-state (registered users only) */}
          <BuddyCard />

          {/* أهداف الرفقة — incoming shared-goal invitations (§10/§12) */}
          <BuddyGoalInvitesCard />

          <SectionsGrid sections={data?.sections ?? []} />

          {/* ساحة الأسئلة — general Q&A entry */}
          <QuestionsHomeCard />

          {/* رحلتي العلمية — quiet personal-progress entry */}
          <JourneyHomeCard />

          {/* Dua card */}
          <View style={{ marginTop: 12 }}>
            <DuaCard />
          </View>

          {/* Support contact — same admin-driven Telegram row as sign-in (empty = hidden) */}
          <SupportContactLink style={{ marginTop: 12 }} />
        </View>
      </Screen>
    </View>
  );
}
