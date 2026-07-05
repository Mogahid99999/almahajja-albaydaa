import { ActivityIndicator, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useHome } from '@/hooks/useSections';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { Screen } from '@/components/ui';
import { BroadcastCard } from '@/components/home/BroadcastCard';
import { ContinueCard } from '@/components/home/ContinueCard';
import { DuaCard } from '@/components/home/DuaCard';
import { GuestBanner } from '@/components/home/GuestBanner';
import { HomeHeader } from '@/components/home/HomeHeader';
import { NewlyAddedRail } from '@/components/home/NewlyAddedRail';
import { FeaturedRail } from '@/components/home/FeaturedRail';
import { BuddyCard } from '@/components/home/BuddyCard';
import { QuestionsHomeCard } from '@/components/home/QuestionsHomeCard';
import { SectionsGrid } from '@/components/home/SectionsGrid';
import { StreakCard } from '@/components/home/StreakCard';
import { JourneyHomeCard } from '@/components/journey/JourneyHomeCard';

/**
 * Home — student landing screen.
 * Reference: screens/رواق العلم.dc.html
 * Layout (top → bottom):
 *   HomeHeader · ContinueCard · NewlyAddedRail · FeaturedRail · SectionsGrid · DuaCard
 *
 * 118px bottom padding clears the globally-mounted MiniPlayer.
 * The MiniPlayer is NOT added here — it lives in the student group layout.
 */
export default function HomeScreen() {
  const { data, isLoading } = useHome();
  const miniPad = useMiniPlayerPad();

  if (isLoading && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgSand, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primaryTeal} />
      </View>
    );
  }

  return (
    <Screen bottomPad={miniPad || 24} padded={false}>
      {/* Header sits inside the screen padding manually so the rail can bleed edge-to-edge */}
      <View style={{ paddingHorizontal: 22 }}>
        <HomeHeader />
      </View>

      {/* Gentle, dismissible register nudge (guests only) */}
      <View style={{ paddingHorizontal: 22 }}>
        <GuestBanner />
      </View>

      {/* تذكير نافع — active admin broadcast (1-day window, dismissible) */}
      <View style={{ paddingHorizontal: 22 }}>
        <BroadcastCard />
      </View>

      {/* Continue listening — full-width inside 22px padding */}
      {data?.continueListening ? (
        <View style={{ paddingHorizontal: 22 }}>
          <ContinueCard continueListening={data.continueListening} />
        </View>
      ) : null}

      {/* أُضيف حديثاً — newest published, auto-sorted (first) */}
      <NewlyAddedRail lectures={data?.newlyAdded ?? []} />

      {/* مختارات — staff-curated horizontal rail (second) */}
      <FeaturedRail lectures={data?.featured ?? []} />

      {/* Sections grid — 22px padding */}
      <View style={{ paddingHorizontal: 22 }}>
        {/* المداومة اليومية — quiet streak state (registered users only) */}
        <StreakCard />

        {/* رفيق الدراسة — invitation / today-state (registered users only) */}
        <BuddyCard />

        <SectionsGrid sections={data?.sections ?? []} />

        {/* ساحة الأسئلة — general Q&A entry */}
        <QuestionsHomeCard />

        {/* رحلتي العلمية — quiet personal-progress entry */}
        <JourneyHomeCard />

        {/* Dua card */}
        <DuaCard />
      </View>
    </Screen>
  );
}
