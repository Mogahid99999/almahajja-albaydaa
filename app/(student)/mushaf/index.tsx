/**
 * المصحف — index. Route: /(student)/mushaf
 * «تابع من حيث توقفت» · live search (sura name, page/sura/juz number — results
 * appear while typing, no «انتقال» button) · السور / الأجزاء / العلامات.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { IconButton, Screen, Txt } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { openMushafReader } from '@/mushaf/open';
import { initPack, usePackStore } from '@/mushaf/pack';
import {
  ar,
  juzStartPage,
  PAGE_COUNT,
  pageInfo,
  searchMushaf,
  SURAS,
  suraStartPage,
  type SearchHit,
} from '@/mushaf/quran';
import { useMushafStore } from '@/mushaf/store';
import { touchMushafUsage } from '@/mushaf/usage';

type Tab = 'suras' | 'juz' | 'marks';

function since(t: number | null) {
  if (!t) return '';
  const d = Math.round((Date.now() - t) / 86_400_000);
  return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : `منذ ${ar(d)} أيام`;
}

function Row({ icon, title, meta, page, onPress, num }: { icon?: keyof typeof Feather.glyphMap; num?: number; title: string; meta: string; page: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}>
      {num ? (
        <View style={styles.numBox}>
          <View style={styles.num} />
          <Txt size={12} weight="semibold" color={colors.primaryTeal}>{ar(num)}</Txt>
        </View>
      ) : (
        <View style={styles.ic}>
          <Feather name={icon ?? 'book-open'} size={16} color={colors.primaryTeal} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={15} weight="display" color={colors.textInk} numberOfLines={1}>{title}</Txt>
        <Txt size={11.5} color={colors.textGhost} numberOfLines={1}>{meta}</Txt>
      </View>
      <Txt size={11.5} color={colors.textGhost}>ص {ar(page)}</Txt>
    </Pressable>
  );
}

function hitRow(h: SearchHit, open: (p: number) => void) {
  if (h.kind === 'page') {
    const i = pageInfo(h.page);
    return <Row key="p" icon="book-open" title={`الانتقال إلى الصفحة ${ar(h.page)}`} meta={`سورة ${i.suraName} · الجزء ${ar(i.juz)}`} page={h.page} onPress={() => open(h.page)} />;
  }
  if (h.kind === 'juz') {
    return <Row key="j" icon="layers" title={`الجزء ${ar(h.juz)}`} meta={`يبدأ في الصفحة ${ar(h.page)}`} page={h.page} onPress={() => open(h.page)} />;
  }
  const s = SURAS[h.sura];
  return (
    <Row
      key={`s${h.sura}`}
      icon="list"
      title={`سورة ${s[2]}`}
      meta={`${s[3] ? 'مدنية' : 'مكية'} · ${ar(s[1])} آية`}
      page={h.page}
      onPress={() => open(h.page)}
    />
  );
}

export default function MushafIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const [tab, setTab] = useState<Tab>('suras');
  const [q, setQ] = useState('');
  const lastPage = useMushafStore((s) => s.lastPage);
  const lastAt = useMushafStore((s) => s.lastAt);
  const bookmarks = useMushafStore((s) => s.bookmarks);
  const pack = usePackStore((s) => s.status);

  useEffect(() => {
    void initPack();
    touchMushafUsage();
  }, []);

  const open = (p: number) => {
    Keyboard.dismiss(); // never carry the search keyboard over a mushaf page
    openMushafReader(router, p);
  };
  const hits = useMemo(() => searchMushaf(q), [q]);
  const searching = q.trim().length > 0;
  const bottomPad = miniPad + insets.bottom + 24 + BOTTOM_NAV_CLEARANCE;
  const cur = lastPage ? pageInfo(lastPage) : null;
  const showPackBanner = Platform.OS !== 'web' && pack.state !== 'ready' && pack.state !== 'checking' && pack.state !== 'unsupported';

  const header = (
    <>
      {showPackBanner ? (
        <Pressable onPress={() => router.push('/mushaf/prepare')} style={({ pressed }) => [styles.packBanner, pressed && { opacity: 0.85 }]}>
          <Feather name="download-cloud" size={16} color={colors.primaryTeal600} />
          <Txt size={12} color={colors.textMuted} style={{ flex: 1, lineHeight: 19 }}>
            {pack.state === 'downloading'
              ? `جارٍ تجهيز مصحف المدينة… ${ar(Math.floor((pack.done / Math.max(1, pack.total)) * 100))}٪`
              : pack.state === 'paused'
                ? 'تجهيز مصحف المدينة متوقف — يمكنك متابعته'
                : 'تقرأ الآن بالخط المبسّط. جهّز مصحف المدينة للقراءة بشكله المطبوع.'}
          </Txt>
          <Feather name="chevron-left" size={16} color={colors.textGhost} />
        </Pressable>
      ) : null}

      {cur && lastPage ? (
        <Pressable onPress={() => open(lastPage)} accessibilityRole="button" style={({ pressed }) => [styles.cont, pressed && { opacity: 0.9 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="bookmark" size={14} color={colors.accentBrass} />
            <Txt size={11.5} color={colors.onTealSecondary} style={{ flex: 1 }}>تابع من حيث توقفت</Txt>
            <Txt size={11} color={colors.onTealSecondary}>{since(lastAt)}</Txt>
          </View>
          <Txt size={22} weight="display" color={colors.onTealPrimary} style={{ marginTop: 6 }}>
            سورة {cur.suraName}
          </Txt>
          <Txt size={12} color={colors.onTealSecondary}>
            الصفحة {ar(lastPage)} · الجزء {ar(cur.juz)}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(1, (lastPage / PAGE_COUNT) * 100)}%` }]} />
            </View>
            <Txt size={11} color={colors.onTealSecondary}>{ar(lastPage)} / {ar(PAGE_COUNT)}</Txt>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.search}>
        <Feather name="search" size={16} color={colors.textGhost} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="اسم السورة، أو رقم صفحة أو جزء"
          placeholderTextColor={colors.textGhost}
          accessibilityLabel="اسم السورة أو رقم الصفحة"
          style={styles.searchInput}
          textAlign="right"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => hits[0] && open(hits[0].page)}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} accessibilityLabel="مسح" hitSlop={8}>
            <Feather name="x" size={16} color={colors.textGhost} />
          </Pressable>
        ) : null}
      </View>

      {searching ? null : (
        <View style={styles.seg}>
          {(
            [
              ['suras', 'السور'],
              ['juz', 'الأجزاء'],
              ['marks', 'العلامات'],
            ] as [Tab, string][]
          ).map(([k, label]) => {
            const on = k === tab;
            return (
              <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.segBtn, on && styles.segOn]}>
                <Txt size={12.5} weight={on ? 'semibold' : 'medium'} color={on ? colors.onTealPrimary : colors.textSlate}>{label}</Txt>
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );

  if (searching) {
    return (
      <Screen scroll={false} bottomPad={0} padded>
        <Title onBack={() => router.back()} />
        <FlatList
          key="rows"
          data={hits}
          keyExtractor={(h, i) => `${h.kind}${i}`}
          renderItem={({ item }) => hitRow(item, open)}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: bottomPad }}
          ListEmptyComponent={
            <Txt size={12.5} color={colors.textGhost} align="center" style={{ paddingVertical: 18 }}>
              {/^[\d٠-٩]+$/.test(q.trim()) ? `أرقام الصفحات من ١ إلى ${ar(PAGE_COUNT)}` : 'لا سورة بهذا الاسم'}
            </Txt>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <Title onBack={() => router.back()} />
      {/* Keyed by column count: the juz grid has numColumns={5}, and React Native
          can't change numColumns on a reused FlatList (Android crash). The
          one-column lists (suras / marks / search) share a key on purpose, so
          the search box in their header is NOT remounted while typing — a
          remount dropped its focus and the next tap only closed the keyboard. */}
      {tab === 'suras' ? (
        <FlatList
          key="rows"
          data={SURAS}
          keyExtractor={(_, i) => String(i)}
          ListHeaderComponent={header}
          initialNumToRender={14}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: bottomPad }}
          ListFooterComponent={<SourceNote />}
          renderItem={({ item, index }) => (
            <Row
              num={index + 1}
              title={item[2]}
              meta={`${item[3] ? 'مدنية' : 'مكية'} · ${ar(item[1])} آية`}
              page={suraStartPage(index)}
              onPress={() => open(suraStartPage(index))}
            />
          )}
        />
      ) : tab === 'juz' ? (
        <FlatList
          key="grid"
          data={Array.from({ length: 30 }, (_, i) => i + 1)}
          keyExtractor={(j) => String(j)}
          numColumns={5}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ gap: 8, paddingBottom: bottomPad }}
          ListFooterComponent={<SourceNote />}
          renderItem={({ item }) => {
            const isCur = cur?.juz === item;
            return (
              <Pressable onPress={() => open(juzStartPage(item))} accessibilityLabel={`الجزء ${ar(item)}`} style={[styles.juz, isCur && styles.juzCur]}>
                <Txt size={13} weight="semibold" color={isCur ? colors.onTealPrimary : colors.primaryTeal}>{ar(item)}</Txt>
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          key="rows"
          data={bookmarks}
          keyExtractor={(p) => String(p)}
          ListHeaderComponent={
            <>
              {header}
              {lastPage ? (
                <Row icon="clock" title={pageInfo(lastPage).suraName} meta="آخر قراءة · تُحفظ وحدها" page={lastPage} onPress={() => open(lastPage)} />
              ) : null}
            </>
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: bottomPad }}
          renderItem={({ item }) => (
            <Row icon="bookmark" title={pageInfo(item).suraName} meta="علامتك" page={item} onPress={() => open(item)} />
          )}
          ListFooterComponent={
            <>
              <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 10, lineHeight: 19 }}>
                موضع القراءة يُحفظ وحده عند كل تقليب. العلامات تضعها أنت من شريط القراءة. وكلاهما يُحفظ على جهازك فقط.
              </Txt>
              <SourceNote />
            </>
          }
        />
      )}
    </Screen>
  );
}

/** Source attribution — quietly at the end of the index, never on a mushaf page. */
function SourceNote() {
  return (
    <View style={styles.source}>
      <View style={styles.sourceRule} />
      <Txt size={11.5} color={colors.textGhost} align="center" style={{ lineHeight: 20 }}>
        نص المصحف وخطوطه من إصدار مجمع الملك فهد لطباعة المصحف الشريف بالمدينة المنورة، جزى الله القائمين عليه خيراً.
      </Txt>
    </View>
  );
}

function Title({ onBack }: { onBack: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <IconButton icon="chevron-right" onPress={onBack} accessibilityLabel="رجوع" />
      <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
        المصحف
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  source: { alignItems: 'center', gap: 10, paddingTop: 20, paddingBottom: 8, paddingHorizontal: 12 },
  sourceRule: { width: 36, height: 1, backgroundColor: colors.borderSand2 },
  packBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgSandRaised,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSand2,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  cont: { backgroundColor: colors.primaryTeal, borderRadius: 18, padding: 16, marginBottom: 12 },
  track: { flex: 1, height: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accentBrass, borderRadius: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13.5, color: colors.textInk, paddingVertical: 10 },
  seg: { flexDirection: 'row', backgroundColor: colors.surfaceInset, borderRadius: 14, padding: 4, gap: 4, marginBottom: 6 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  segOn: { backgroundColor: colors.primaryTeal },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHair,
  },
  numBox: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  num: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.accentBrassSoft,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  ic: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceInset, alignItems: 'center', justifyContent: 'center' },
  juz: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
  },
  juzCur: { backgroundColor: colors.primaryTeal, borderColor: colors.primaryTeal },
});

