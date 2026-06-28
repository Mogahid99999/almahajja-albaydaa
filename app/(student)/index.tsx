import { ActivityIndicator, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useHome } from '@/hooks/useSections';
import { Screen } from '@/components/ui';
import { ContinueCard } from '@/components/home/ContinueCard';
import { DuaCard } from '@/components/home/DuaCard';
import { HomeHeader } from '@/components/home/HomeHeader';
import { NewlyAddedRail } from '@/components/home/NewlyAddedRail';
import { SectionsGrid } from '@/components/home/SectionsGrid';
import { JourneyHomeCard } from '@/components/journey/JourneyHomeCard';

/**
 * Home — student landing screen.
 * Reference: screens/رواق العلم.dc.html
 * Layout (top → bottom):
 *   HomeHeader · ContinueCard · NewlyAddedRail · SectionsGrid · DuaCard
 *
 * 118px bottom padding clears the globally-mounted MiniPlayer.
 * The MiniPlayer is NOT added here — it lives in the student group layout.
 */
export default function HomeScreen() {
  const { data, isLoading } = useHome();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgSand, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primaryTeal} />
      </View>
    );
  }

  return (
    <Screen bottomPad={118} padded={false}>
      {/* Header sits inside the screen padding manually so the rail can bleed edge-to-edge */}
      <View style={{ paddingHorizontal: 22 }}>
        <HomeHeader />
      </View>

      {/* Continue listening — full-width inside 22px padding */}
      {data?.continueListening ? (
        <View style={{ paddingHorizontal: 22 }}>
          <ContinueCard continueListening={data.continueListening} />
        </View>
      ) : null}

      {/* Newly added — horizontal rail; manages its own padding */}
      <NewlyAddedRail lectures={data?.newlyAdded ?? []} />

      {/* Sections grid — 22px padding */}
      <View style={{ paddingHorizontal: 22 }}>
        <SectionsGrid sections={data?.sections ?? []} />

        {/* رحلتي العلمية — quiet personal-progress entry */}
        <JourneyHomeCard />

        {/* Dua card */}
        <DuaCard />
      </View>
    </Screen>
  );
}
