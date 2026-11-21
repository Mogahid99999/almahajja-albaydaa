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
  pageInfo,
  pageLines,
  suraName,
  tokenWords,
  type Line,
} from '@/mushaf/quran';
import { FONT_LEVELS } from '@/mushaf/store';

import { MushafSheet, sheetGeometry, TEXT_H, TEXT_W } from './MushafFrame';

export type MushafMode = 'print' | 'simple' | 'flex';
export const HAFS_FAMILY = 'UthmanicHafsV22';

const PAPER = '#f8f1e1';
const INK = '#231f1b';
const MARK = '#8a6a35';
const PAGE_W = FIXED.width; // 340
const PAGE_H = 588;
// The frame is drawn around exactly this box; a mismatch would shift lines.
if (PAGE_W !== TEXT_W || PAGE_H !== TEXT_H) throw new Error('mushaf text box and frame disagree');
const LINE_H = PAGE_H / 15;
const FLEX_BASE = 20.5;
/** Hafs line box ≈ (2371 + 1217) / 2048 = 1.75 em; + 0.3 em = the old 2.05 em pitch. */
const FLEX_ROW_GAP_EM = 0.3;

/**
 * Ink room (2026-11-21, a student's report: word starts, their first diacritics,
 * the second dot of an initial ي cut off). Android's TextView clips its text to its
 * content box horizontally (padding moves the clip with it) and to its outer box
 * vertically. Measured over the whole mushaf (all 604 pages / all 21 133 words):
 *   Madinah page fonts — real ink reaches 0.51 em past a word's advance on its
 *     start side, 0.23 em on its end side; beyond that the fonts only carry a few
 *     stray specks (< 0.002 em², up to 2.3 em away) that were never meant to show;
 *   Hafs (simplified) — marks reach 0.93 em (start) / 0.73 em (end), and stacked
 *     marks 0.06 em above / 0.03 em below the font's own box.
 * So a word carries no-break spaces of the bundled Hafs font on each side (450/2048
 * em each, no line-break point): 3 for the Madinah fonts (0.66 em — every letter and
 * mark with ≥ 0.15 em to spare, the far specks still hidden), 5 for Hafs (1.1 em);
 * plus 0.15 em of vertical padding. Equal negative margins put the word exactly
 * where it was: lines and justification don't move.
 */
const NBSP_EM = 450 / 2048;
const V_ROOM_EM = 0.15;
const NBSP = String.fromCharCode(0xa0);

function Word({
  size,
  family,
  color,
  room,
  children,
}: {
  size: number;
  family: string;
  color: string;
  /** No-break spaces on each side. */
  room: number;
  children: string;
}) {
  const pad = NBSP.repeat(room);
  return (
    <Text
      allowFontScaling={false}
      style={{
        fontFamily: HAFS_FAMILY,
        fontSize: size,
        color,
        marginHorizontal: -size * NBSP_EM * room,
        paddingVertical: size * V_ROOM_EM,
        marginVertical: -size * V_ROOM_EM,
      }}
    >
      {pad}
      <Text style={{ fontFamily: family }}>{children}</Text>
      {pad}
    </Text>
  );
}
const ROOM_PRINT = 3;
const ROOM_HAFS = 5;

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
  const geo = sheetGeometry(width, height);
  const info = pageInfo(page);
  const shown = opening ? lines.filter((l) => l.t !== 'e') : lines;

  const renderText = (l: Extract<Line, { t: 'x' }>, li: number) => {
    if (print) {
      if (!fontReady) return null;
      const g = glyphs!;
      const words = g.pages[page - 1][li].split(' ');
      const size = g.fx.font * (g.shrink[`${page}.${li + 1}`] ?? 1);
      return words.map((w, i) => (
        <Word key={i} size={size} family={qcfFamily(page)} color={INK} room={ROOM_PRINT}>
          {w}
        </Word>
      ));
    }
    const size = FIXED.font * l.shrink;
    const out: ReactNode[] = [];
    l.tokens.forEach((t, ti) => {
      if (t.k === 'n') {
        out.push(
          <Word key={ti} size={size} family={HAFS_FAMILY} color={MARK} room={ROOM_HAFS}>
            {ar(ayahNumber(t.g))}
          </Word>,
        );
      } else {
        tokenWords(text, t).forEach((w, wi) =>
          out.push(
            <Word key={`${ti}.${wi}`} size={size} family={HAFS_FAMILY} color={INK} room={ROOM_HAFS}>
              {w}
            </Word>,
          ),
        );
      }
    });
    return out;
  };

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <MushafSheet geo={geo} page={page} suraTitle={`سُورَةُ ${info.suraName}`} juz={info.juz}>
      <View
        style={{
          width: PAGE_W,
          height: PAGE_H,
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
                <Word size={20} family={HAFS_FAMILY} color={INK} room={ROOM_HAFS}>
                  {BASMALA}
                </Word>
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
      </MushafSheet>
    </View>
  );
}

function FlexPage({ page, text, level, bottomPad }: { page: number; text: readonly string[]; level: number; bottomPad: number }) {
  const size = FLEX_BASE * FONT_LEVELS[level];
  const blocks: ReactNode[] = [];
  let para: ReactNode[] = [];
  // One item per word (not one paragraph Text): a paragraph clips the ink of the
  // words at its own edges — the tail of every line's last word. Lines are justified
  // per line (space-between, at least a space apart); the paragraph's last line is
  // packed to its start by the growing spacer. Line pitch stays 2.05 em.
  const flush = (key: string) => {
    if (!para.length) return;
    blocks.push(
      <View key={key} style={[styles.flexPara, { columnGap: size * NBSP_EM * 1.2, rowGap: size * FLEX_ROW_GAP_EM }]}>
        {para}
        <View style={{ flexGrow: 1 }} />
      </View>,
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
        <Text key={`b${i}`} allowFontScaling={false} style={[styles.flexBasm, { fontSize: size, lineHeight: size * 2 }]}>
          {BASMALA}
        </Text>,
      );
    } else if (l.t === 'x') {
      l.tokens.forEach((t, ti) => {
        if (t.k === 'n') {
          para.push(
            <Word key={`${i}.${ti}`} size={size} family={HAFS_FAMILY} color={MARK} room={ROOM_HAFS}>
              {ar(ayahNumber(t.g))}
            </Word>,
          );
        } else {
          tokenWords(text, t).forEach((w, wi) =>
            para.push(
              <Word key={`${i}.${ti}.${wi}`} size={size} family={HAFS_FAMILY} color={INK} room={ROOM_HAFS}>
                {w}
              </Word>,
            ),
          );
        }
      });
    }
  });
  flush('end');
  return (
    <ScrollView
      style={{ flex: 1 }}
      // Wide enough for the farthest Hafs mark at the line edges (0.93 em) at every size.
      contentContainerStyle={{ paddingTop: 56, paddingHorizontal: Math.max(18, size * 0.95), paddingBottom: bottomPad }}
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
  flexPara: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  flexBasm: { fontFamily: HAFS_FAMILY, color: INK, textAlign: 'center', marginBottom: 6 },
});
