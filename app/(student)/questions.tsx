/**
 * مساحة الأسئلة — three independent sections (Concept 1 «الأبواب الثلاثة»):
 *   أسئلة عامة  — general questions (category 'general'), ask + browse
 *   فتاوى        — fatwa requests (category 'fatwa'), ask + browse
 *   أسئلة المحاضرات — every answered lesson question, display-only, linked to its lesson
 * Route: /(student)/questions[?tab=general|fatwa|lecture] (Home door + question_answered deep-link).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { LectureQuestionsFeed } from '@/components/questions/LectureQuestionsFeed';
import { QuestionsBoard } from '@/components/questions/QuestionsBoard';
import { IconButton, Screen, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useQnaNotice } from '@/hooks/useAppContent';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

type Section = 'general' | 'fatwa' | 'lecture';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'general', label: 'أسئلة عامة' },
  { key: 'fatwa', label: 'فتاوى' },
  { key: 'lecture', label: 'أسئلة المحاضرات' },
];

function SectionSwitch({ value, onChange }: { value: Section; onChange: (s: Section) => void }) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceInset,
        borderRadius: 14,
        padding: 4,
        gap: 4,
        marginBottom: 12,
      }}
    >
      {SECTIONS.map((s) => {
        const on = s.key === value;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: 8,
              paddingHorizontal: 4,
              borderRadius: 10,
              backgroundColor: on ? colors.primaryTeal : 'transparent',
              opacity: pressed && !on ? 0.7 : 1,
            })}
          >
            <Txt
              size={12.5}
              weight={on ? 'semibold' : 'medium'}
              color={on ? colors.onTealPrimary : colors.textSlate}
              numberOfLines={1}
            >
              {s.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function QuestionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const { data: qnaNotice } = useQnaNotice();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [section, setSection] = useState<Section>(
    params.tab === 'fatwa' || params.tab === 'lecture' ? params.tab : 'general',
  );
  const bottomPad = miniPad + insets.bottom + 24 + BOTTOM_NAV_CLEARANCE;

  const switcher = (
    <>
      {qnaNotice?.text && section !== 'lecture' ? (
        <Txt size={11.5} color={colors.textGhost} style={{ marginBottom: 12, lineHeight: 18 }}>
          {qnaNotice.text}
        </Txt>
      ) : null}
      <SectionSwitch value={section} onChange={setSection} />
    </>
  );

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          مساحة الأسئلة
        </Txt>
      </View>
      <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 12, lineHeight: 20 }}>
        اسأل عمّا أشكل عليك، ويجيبك الشيخ، وتنتفع بأسئلة إخوانك
      </Txt>

      {section === 'lecture' ? (
        <LectureQuestionsFeed headerTop={switcher} bottomPad={bottomPad} />
      ) : (
        // key: each section is its own board (own tab/scroll state, own composer).
        <QuestionsBoard
          key={section}
          scope="general"
          category={section}
          headerTop={switcher}
          bottomPad={bottomPad}
        />
      )}
    </Screen>
  );
}
