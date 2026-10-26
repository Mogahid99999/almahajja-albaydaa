/**
 * One mushaf page, in one of three modes:
 *   print  — Madinah print: each word drawn by that page's own font (downloaded pack)
 *   simple — the same 15 lines in the bundled KFGQPC Hafs V22 font («الخط المبسّط»)
 *   flex   — enlarged reading: the page's V22 text reflows and scrolls vertically
 *
 * Fixed modes lay the page out ONCE at a logical 340×588 and scale the whole
 * page to the screen, so lines never reflow. Every line is justified by word
 * spacing only; the few lines wider than the page get one uniform shrink
 * (precomputed at build time). Text and diacritics are never changed.
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { colors, fonts } from '@/constants/theme';
import type { GlyphIndex } from '@/mushaf/pack';
import { ensurePageFont, isPageFontLoaded, qcfFamily } from '@/mushaf/qcfFonts';
import {
  ar,
  ayahNumber,
  BASMALA,
  FIXED,
  isOpeningPage,
  pageLines,
  suraName,
  tokenWords,
  type Line,
} from '@/mushaf/quran';
import { FONT_LEVELS } from '@/mushaf/store';

export type MushafMode = 'print' | 'simple' | 'flex';
export const HAFS_FAMILY = 'UthmanicHafsV22';

const PAPER = '#f8f1e1';
const INK = '#231f1b';
const MARK = '#8a6a35';
const PAGE_W = FIXED.width; // 340
const PAGE_H = 588;
const LINE_H = PAGE_H / 15;
const FLEX_BASE = 20.5;

function SuraHeader({ sura, flex }: { sura: number; flex?: boolean }) {
  return (
    <View style={[styles.hdOuter, flex && { width: '100%', marginVertical: 10 }]}>
      <View style={styles.hdInner}>
        <Text style={styles.hdText} allowFontScaling={false}>
          سُورَةُ {suraName(sura)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Whether THIS page's font is registered — read from the font registry on every
 * render, never remembered: the pager reuses its three slots across turns, so a
 * flag kept in state would still say «ready» for the previous page and draw the
 * new page's glyph codes before its font exists (blank words that never redraw).
 * The state only triggers the redraw once the font has loaded.
 */
function usePageFont(packUri: string | null, page: number, enabled: boolean) {
  const [, setLoadedTick] = useState(0);
  useEffect(() => {
    if (!enabled || !packUri || isPageFontLoaded(page)) return;
    let alive = true;
    ensurePageFont(packUri, page).then(
      () => alive && setLoadedTick((n) => n + 1),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [packUri, page, enabled]);
  return isPageFontLoaded(page);
}

function FixedPage({
  page,
  mode,
  text,
  glyphs,
  packUri,
  width,
  height,
}: {
  page: number;
  mode: 'print' | 'simple';
  text: readonly string[];
  glyphs: GlyphIndex | null;
  packUri: string | null;
  width: number;
  height: number;
}) {
  const print = mode === 'print' && !!glyphs;
  const fontReady = usePageFont(packUri, page, print);
  const lines = pageLines(page);
  const opening = isOpeningPage(page);
  const k = Math.min(width / (PAGE_W + 12), (height - 36) / (PAGE_H + 4));
  const shown = opening ? lines.filter((l) => l.t !== 'e') : lines;

  const renderText = (l: Extract<Line, { t: 'x' }>, li: number) => {
    if (print) {
      if (!fontReady) return null;
      const g = glyphs!;
      const words = g.pages[page - 1][li].split(' ');
      const size = g.fx.font * (g.shrink[`${page}.${li + 1}`] ?? 1);
      return words.map((w, i) => (
        <Text key={i} allowFontScaling={false} style={{ fontFamily: qcfFamily(page), fontSize: size, color: INK }}>
          {w}
        </Text>
      ));
    }
    const size = FIXED.font * l.shrink;
    const out: ReactNode[] = [];
    l.tokens.forEach((t, ti) => {
      if (t.k === 'n') {
        out.push(
          <Text key={ti} allowFontScaling={false} style={{ fontFamily: HAFS_FAMILY, fontSize: size, color: MARK }}>
            {ar(ayahNumber(t.g))}
          </Text>,
        );
      } else {
        tokenWords(text, t).forEach((w, wi) =>
          out.push(
            <Text key={`${ti}.${wi}`} allowFontScaling={false} style={{ fontFamily: HAFS_FAMILY, fontSize: size, color: INK }}>
              {w}
            </Text>,
          ),
        );
      }
    });
    return out;
  };

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 }}>
      <View
        style={{
          width: PAGE_W,
          height: PAGE_H,
          transform: [{ scale: k }],
          justifyContent: opening ? 'center' : 'space-between',
          gap: opening ? 2 : 0,
        }}
      >
        {shown.map((l, i) => {
          const li = opening ? lines.indexOf(l) : i;
          if (l.t === 'h')
            return (
              <View key={i} style={[styles.fxRow, { justifyContent: 'center' }]}>
                <SuraHeader sura={l.sura} />
              </View>
            );
          if (l.t === 'b')
            return (
              <View key={i} style={[styles.fxRow, { justifyContent: 'center' }]}>
                <Text allowFontScaling={false} style={{ fontFamily: HAFS_FAMILY, fontSize: 20, color: INK }}>
                  {BASMALA}
                </Text>
              </View>
            );
          if (l.t === 'e') return <View key={i} style={styles.fxRow} />;
          return (
            <View
              key={i}
              style={[
                styles.fxRow,
                opening
                  ? { justifyContent: 'center', gap: 5, width: 260, alignSelf: 'center' }
                  : { justifyContent: 'space-between' },
              ]}
            >
              {renderText(l, li)}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function FlexPage({ page, text, level, bottomPad }: { page: number; text: readonly string[]; level: number; bottomPad: number }) {
  const size = FLEX_BASE * FONT_LEVELS[level];
  const blocks: ReactNode[] = [];
  let para: ReactNode[] = [];
  const flush = (key: string) => {
    if (!para.length) return;
    blocks.push(
      <Text key={key} style={[styles.flexPara, { fontSize: size, lineHeight: size * 2.05 }]}>
        {para}
      </Text>,
    );
    para = [];
  };
  pageLines(page).forEach((l, i) => {
    if (l.t === 'h') {
      flush(`p${i}`);
      blocks.push(<SuraHeader key={`h${i}`} sura={l.sura} flex />);
    } else if (l.t === 'b') {
      flush(`p${i}`);
      blocks.push(
        <Text key={`b${i}`} style={[styles.flexBasm, { fontSize: size, lineHeight: size * 2 }]}>
          {BASMALA}
        </Text>,
      );
    } else if (l.t === 'x') {
      l.tokens.forEach((t, ti) => {
        if (t.k === 'n') {
          para.push(
            <Text key={`${i}.${ti}`} style={{ color: MARK }}>
              {' '}
              {ar(ayahNumber(t.g))}{' '}
            </Text>,
          );
        } else {
          const words = tokenWords(text, t).join(' ');
          para.push(para.length ? ' ' + words : words);
        }
      });
    }
  });
  flush('end');
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 18, paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
      overScrollMode="never"
    >
      {blocks}
    </ScrollView>
  );
}

export const MushafPage = memo(function MushafPage(props: {
  page: number;
  mode: MushafMode;
  level: number;
  text: readonly string[];
  glyphs: GlyphIndex | null;
  packUri: string | null;
  width: number;
  height: number;
}) {
  return (
    <View style={{ width: props.width, height: props.height, backgroundColor: PAPER }}>
      {props.mode === 'flex' ? (
        <FlexPage page={props.page} text={props.text} level={props.level} bottomPad={72} />
      ) : (
        <FixedPage
          page={props.page}
          mode={props.mode}
          text={props.text}
          glyphs={props.glyphs}
          packUri={props.packUri}
          width={props.width}
          height={props.height}
        />
      )}
    </View>
  );
});

export const MUSHAF_PAPER = PAPER;

const styles = StyleSheet.create({
  fxRow: { height: LINE_H, flexDirection: 'row', alignItems: 'center' },
  hdOuter: {
    width: '92%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.accentBrassSoft,
    borderRadius: 10,
    padding: 3,
    backgroundColor: colors.bgSandRaised,
  },
  hdInner: { borderWidth: 1, borderColor: colors.borderSand2, borderRadius: 7, paddingVertical: 1, alignItems: 'center' },
  hdText: { fontFamily: fonts.display, fontSize: 15, color: colors.primaryTeal, lineHeight: 26 },
  flexPara: { fontFamily: HAFS_FAMILY, color: INK, textAlign: 'justify', writingDirection: 'rtl', marginBottom: 6 },
  flexBasm: { fontFamily: HAFS_FAMILY, color: INK, textAlign: 'center', marginBottom: 6 },
});
