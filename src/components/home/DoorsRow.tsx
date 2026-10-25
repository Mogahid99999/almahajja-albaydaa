import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { openMushafReader } from '@/mushaf/open';
import { initPack, startPackDownload, usePackStore } from '@/mushaf/pack';
import { ar, pageInfo } from '@/mushaf/quran';
import { useMushafStore } from '@/mushaf/store';

/**
 * «أبواب» — the three Home doors (Concept 1): الأسئلة · الفوائد · المصحف.
 * Replaces the single QuestionsHomeCard in the same slot.
 *
 * Also the app-start hook for the Madinah pack: an interrupted download (app
 * killed, network lost) resumes on the next launch — never while the app is closed.
 */
function Door({
  icon,
  title,
  sub,
  label,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  sub: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: colors.primaryTeal,
            borderWidth: 2,
            borderColor: colors.accentBrass,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 6,
          }}
        >
          <Feather name={icon} size={18} color={colors.onTealPrimary} />
        </View>
        <Txt weight="display" size={15} color={colors.primaryTeal}>
          {title}
        </Txt>
        <Txt size={10.5} color={colors.textGhost} numberOfLines={1}>
          {sub}
        </Txt>
      </Card>
    </Pressable>
  );
}

export function DoorsRow() {
  const router = useRouter();
  const lastPage = useMushafStore((s) => s.lastPage);

  useEffect(() => {
    void initPack().then(() => {
      const s = usePackStore.getState().status;
      if (s.state === 'paused' && s.reason === 'interrupted') void startPackDownload();
    });
  }, []);

  const mushafSub = lastPage ? `${pageInfo(lastPage).suraName} · ص ${ar(lastPage)}` : 'اقرأ وتدبّر';

  return (
    <View style={{ marginTop: 12 }}>
      <Txt weight="display" size={18} color={colors.primaryTeal} style={{ marginBottom: 10, marginTop: 10 }}>
        أبواب
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Door
          icon="help-circle"
          title="الأسئلة"
          sub="عامة · فتاوى · الدروس"
          label="مساحة الأسئلة"
          onPress={() => router.push('/(student)/questions')}
        />
        <Door
          icon="feather"
          title="الفوائد"
          sub="فوائد الدارسين"
          label="فوائد الدارسين"
          onPress={() => router.push('/(student)/benefits')}
        />
        <Door
          icon="book-open"
          title="المصحف"
          sub={mushafSub}
          label="المصحف"
          onPress={() => openMushafReader(router, lastPage ?? undefined)}
        />
      </View>
    </View>
  );
}
