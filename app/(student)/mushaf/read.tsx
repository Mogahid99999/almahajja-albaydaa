/**
 * المصحف — the reader. Route: /(student)/mushaf/read[?page=N]
 *
 * Mode: Madinah print once the pack is verified; the bundled simplified font
 * before that; enlarged (reflowed, vertical scroll) whenever A+ is on.
 * Chrome (index · sura/juz · Tt · bookmark) appears on tap and hides itself
 * while reading. The position is saved on every page turn. With a daily wird,
 * the page on screen counts toward it once it has really been read
 * (useWirdReading); its progress sits in the reading bar only.
 */
import Feather from '@expo/vector-icons/Feather';
import { useFonts } from 'expo-font';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';
// The reading chrome sits over the pager's native Pan/Tap; gesture-handler's
// Pressable joins that arbitration, so a press on Tt / ☰ isn't lost to it.
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MushafPage, MUSHAF_PAPER, HAFS_FAMILY, type MushafMode } from '@/components/mushaf/MushafPage';
import { MushafPager } from '@/components/mushaf/MushafPager';
import { TextSizeIcon } from '@/components/mushaf/TextSizeIcon';
import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { activePackUri, cachedGlyphIndex, initPack, loadGlyphIndex, usePackStore, type GlyphIndex } from '@/mushaf/pack';
import { ar, clampPage, pageInfo } from '@/mushaf/quran';
import { FONT_LEVELS, useMushafStore } from '@/mushaf/store';
import { useQuranText } from '@/mushaf/text';
import { touchMushafUsage } from '@/mushaf/usage';
import { useWirdReading } from '@/mushaf/useWirdReading';
import { useWirdToday } from '@/mushaf/useWirdToday';

const CHROME_MS = 3500;

export default function MushafReader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ page?: string }>();
  const [fontsOk] = useFonts({ [HAFS_FAMILY]: require('../../../assets/fonts/UthmanicHafs_V22.ttf') });
  const { text, error: textError } = useQuranText();

  const lastPage = useMushafStore((s) => s.lastPage);
  const setLast = useMushafStore((s) => s.setLast);
  const bookmarks = useMushafStore((s) => s.bookmarks);
  const toggleBookmark = useMushafStore((s) => s.toggleBookmark);
  const level = useMushafStore((s) => s.fontLevel);
  const setLevel = useMushafStore((s) => s.setFontLevel);
  const hintSeen = useMushafStore((s) => s.hintSeen);
  const setHintSeen = useMushafStore((s) => s.setHintSeen);
  const packState = usePackStore((s) => s.status.state);

  const [page, setPage] = useState(() => clampPage(Number(params.page) || lastPage || 1));
  const [chrome, setChrome] = useState(true);
  const [fsOpen, setFsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // The font panel opens just under the bar, whose height grows with the wird line.
  const [barH, setBarH] = useState(52);
  // Already in memory after the first open → no simplified-then-print double render.
  const [glyphs, setGlyphs] = useState<GlyphIndex | null>(cachedGlyphIndex);


  useEffect(() => {
    void initPack();
    touchMushafUsage();
  }, []);

  // A jump from the index while this screen is still mounted.
  useEffect(() => {
    if (params.page) setPage(clampPage(Number(params.page)));
  }, [params.page]);

  useEffect(() => {
    setLast(page);
  }, [page, setLast]);

  const printReady = packState === 'ready';
  useEffect(() => {
    if (!printReady) return;
    let alive = true;
    loadGlyphIndex().then(
      (g) => alive && setGlyphs(g),
      () => alive && setGlyphs(null),
    );
    return () => {
      alive = false;
    };
  }, [printReady]);

  const mode: MushafMode = level > 0 ? 'flex' : printReady && glyphs ? 'print' : 'simple';

  // On Android a touch on the reading bar ALSO reaches the page's native Tap
  // gesture underneath, which then hid the bar (and closed the font panel)
  // right after the button's own press — so Tt / ☰ looked dead. Touches that
  // start on the chrome are stamped here and the page tap ignores them.
  const chromeTouchAt = useRef(0);
  // ☰: back to the index when it is the screen underneath; otherwise (opened
  // from the Home door / «تابع») swap the reader for it. navigate('/mushaf')
  // did nothing on device in the second case.
  const navigation = useNavigation();
  const openIndex = () => {
    const st = navigation.getState();
    const prev = st ? st.routes[st.index - 1] : undefined;
    if (prev?.name === 'mushaf/index') router.back();
    else router.replace('/mushaf');
  };
  const onChromeTouch = () => {
    chromeTouchAt.current = Date.now();
  };
  const showChrome = useCallback((on: boolean) => {
    setChrome(on);
    if (!on) setFsOpen(false);
  }, []);
  // Auto-hide while the font panel is closed.
  useEffect(() => {
    if (!chrome || fsOpen) return;
    const t = setTimeout(() => setChrome(false), CHROME_MS);
    return () => clearTimeout(t);
  }, [chrome, fsOpen, page]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const wird = useWirdToday();
  const [wirdDone, setWirdDone] = useState(false);
  useWirdReading(page, fontsOk && !!text, () => setWirdDone(true));
  useEffect(() => {
    if (!wirdDone) return;
    const t = setTimeout(() => setWirdDone(false), 6000);
    return () => clearTimeout(t);
  }, [wirdDone]);

  const info = pageInfo(page);
  const marked = bookmarks.includes(page);
  const ready = fontsOk && !!text;
  const top = insets.top;

  const renderPage = useCallback(
    (p: number) =>
      text ? (
        <MushafPage
          page={p}
          mode={mode}
          level={level}
          text={text}
          glyphs={glyphs}
          packUri={activePackUri()}
          width={width}
          height={height - top}
        />
      ) : null,
    [text, mode, level, glyphs, width, height, top],
  );

  return (
    <View style={{ flex: 1, backgroundColor: MUSHAF_PAPER, paddingTop: top }}>
      <StatusBar style="dark" />
      {!ready ? (
        <View style={styles.center}>
          {textError ? (
            <Txt size={13} color={colors.textMuted}>تعذّر فتح المصحف</Txt>
          ) : (
            <ActivityIndicator color={colors.primaryTeal} />
          )}
        </View>
      ) : (
        <MushafPager
          page={page}
          width={width}
          height={height - top}
          strictHorizontal={mode === 'flex'}
          onPageChange={(p) => {
            setPage(p);
            if (!hintSeen) setHintSeen();
          }}
          onTurnStart={() => {
            if (chrome) showChrome(false);
          }}
          onTap={() => {
            if (Date.now() - chromeTouchAt.current < 600) return;
            showChrome(!chrome);
          }}
          renderPage={renderPage}
        />
      )}

      {/* Quiet reading chrome */}
      {chrome ? (
        <View
          style={[styles.bar, { top }]}
          onTouchStart={onChromeTouch}
          onLayout={(e) => setBarH(e.nativeEvent.layout.height)}
        >
          <Pressable onPress={openIndex} accessibilityLabel="الفهرس" hitSlop={6} style={styles.ib}>
            <Feather name="list" size={19} color={colors.primaryTeal} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Txt size={16} weight="display" color={colors.primaryTeal} numberOfLines={1}>
              {info.suraName}
            </Txt>
            <Txt size={10.5} color={colors.textGhost}>
              الجزء {ar(info.juz)} · صفحة {ar(page)}
            </Txt>
            {wird.goal != null ? (
              <Txt size={10.5} weight="semibold" color={wird.done ? colors.stateSuccess : colors.accentBrassMuted}>
                {/* «من», not «·» or «/»: beside Arabic digits a dot reads as a zero (١٠). */}
                {wird.done
                  ? 'ورد اليوم: أتممته'
                  : `ورد اليوم: ${ar(Math.min(wird.count, wird.goal))} من ${ar(wird.goal)}`}
              </Txt>
            ) : null}
          </View>
          <Pressable
            onPress={() => {
              setFsOpen((o) => !o);
              setChrome(true);
            }}
            accessibilityLabel="حجم الخط"
            accessibilityState={{ expanded: fsOpen }}
            hitSlop={6}
            style={[styles.ib, fsOpen && styles.ibOn]}
          >
            <TextSizeIcon color={colors.primaryTeal} />
          </Pressable>
          <Pressable
            onPress={() => {
              const on = toggleBookmark(page);
              setToast(on ? `وُضعت علامة على الصفحة ${ar(page)}` : 'أُزيلت العلامة');
              showChrome(true);
            }}
            accessibilityLabel={marked ? 'إزالة العلامة' : 'وضع علامة'}
            accessibilityState={{ selected: marked }}
            hitSlop={6}
            style={styles.ib}
          >
            <Feather name="bookmark" size={19} color={marked ? colors.accentBrass : colors.accentBrassMuted} />
            {marked ? <View style={styles.bmDot} /> : null}
          </Pressable>
        </View>
      ) : null}

      {chrome && fsOpen ? (
        <View style={[styles.fsPanel, { top: top + barH + 6 }]} onTouchStart={onChromeTouch}>
          <View style={styles.fsRow}>
            <Pressable
              onPress={() => setLevel(level - 1)}
              disabled={level === 0}
              accessibilityLabel="تصغير الخط"
              style={[styles.fsBtn, level === 0 && { opacity: 0.35 }]}
            >
              <Txt size={15} weight="display" color={colors.primaryTeal}>أ−</Txt>
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Txt size={14} weight="semibold" color={colors.textInk}>
                {level === 0 ? 'الحجم الأصلي' : `مكبّر ${ar(Math.round(FONT_LEVELS[level] * 100))}٪`}
              </Txt>
              <Txt size={11} color={colors.textGhost} align="center">
                {level === 0 ? 'صفحة المصحف كما هي، بسطورها الخمسة عشر' : 'النص يُعاد توزيعه لراحة القراءة'}
              </Txt>
              <View style={styles.dots}>
                {FONT_LEVELS.map((_, k) => (
                  <View key={k} style={[styles.dot, k <= level && { backgroundColor: colors.accentBrass }]} />
                ))}
              </View>
            </View>
            <Pressable
              onPress={() => setLevel(level + 1)}
              disabled={level === FONT_LEVELS.length - 1}
              accessibilityLabel="تكبير الخط"
              style={[styles.fsBtn, level === FONT_LEVELS.length - 1 && { opacity: 0.35 }]}
            >
              <Txt size={21} weight="display" color={colors.primaryTeal}>أ+</Txt>
            </Pressable>
          </View>
          <Pressable
            onPress={() => setLevel(0)}
            disabled={level === 0}
            style={[styles.fsReset, level === 0 && { opacity: 0.45 }]}
          >
            <Txt size={12.5} weight="semibold" color={colors.primaryTeal}>
              العودة إلى الحجم الأصلي (صفحة المصحف)
            </Txt>
          </Pressable>
        </View>
      ) : null}

      {level > 0 && !fsOpen ? (
        <Pressable
          onPress={() => {
            setLevel(0);
            setToast('عادت صفحة المصحف إلى حجمها الأصلي');
          }}
          onTouchStart={onChromeTouch}
          style={[styles.pill, { bottom: insets.bottom + 34 }]}
        >
          <Txt size={11.5} weight="semibold" color={colors.primaryTeal}>
            خط مكبّر · العودة إلى الحجم الأصلي
          </Txt>
        </Pressable>
      ) : null}

      <View pointerEvents="none" style={[styles.foot, { bottom: insets.bottom + 10 }]}>
        <Txt size={10.5} color={colors.textFaint}>{info.suraName}</Txt>
        <Txt size={12} weight="semibold" color={colors.textSlate}>{ar(page)}</Txt>
        <Txt size={10.5} color={colors.textFaint}>الجزء {ar(info.juz)}</Txt>
      </View>

      {ready && !hintSeen && !fsOpen ? (
        <View pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 64 }]}>
          <Feather name="arrow-right" size={14} color={colors.onTealPrimary} />
          <Txt size={12} color={colors.onTealPrimary}>اسحب إلى اليمين للصفحة التالية</Txt>
        </View>
      ) : null}

      {wirdDone ? (
        <Pressable
          onPress={() => setWirdDone(false)}
          onTouchStart={onChromeTouch}
          accessibilityRole="alert"
          style={[styles.wirdDone, { bottom: insets.bottom + 56 }]}
        >
          <Txt size={14.5} weight="semibold" color={colors.primaryTeal} align="center">
            أتممت وردك اليومي 🤍
          </Txt>
          <Txt size={12.5} color={colors.textMuted} align="center">
            تقبّل الله منك وزادك علماً وهدى.
          </Txt>
        </Pressable>
      ) : null}

      {toast ? (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 64 }]}>
          <Txt size={12.5} color={colors.onTealPrimary}>{toast}</Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(248,241,225,0.97)',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSand,
  },
  ib: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSand,
    backgroundColor: colors.surfaceCard,
  },
  ibOn: { backgroundColor: colors.surfaceInset },
  bmDot: { position: 'absolute', top: 7, right: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentBrass },
  fsPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    borderRadius: 16,
    padding: 12,
    elevation: 6,
    shadowColor: '#16352f',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  fsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fsBtn: {
    width: 52,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    backgroundColor: colors.bgSandRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 6, marginTop: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderSand2 },
  fsReset: { marginTop: 10, borderRadius: 12, paddingVertical: 9, alignItems: 'center', backgroundColor: colors.surfaceInset },
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.surfaceInset,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderSand2,
  },
  foot: {
    position: 'absolute',
    left: 22,
    right: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryTealDeep,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  wirdDone: {
    position: 'absolute',
    alignSelf: 'center',
    gap: 3,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 16,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    elevation: 4,
    shadowColor: '#16352f',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.primaryTealDeep,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
});
