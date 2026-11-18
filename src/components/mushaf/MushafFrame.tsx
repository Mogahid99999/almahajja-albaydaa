/**
 * The printed-page dress of a fixed mushaf page: a quiet ornamental frame,
 * the sura | juz strip above it and the page number set into its lower edge.
 *
 * Everything is drawn in the page's LOGICAL units around the untouched 340×588
 * text box (see MushafPage) and scaled together with it, so the frame never
 * changes how a line is laid out — it only adds margin around the box.
 * The ornament does not depend on the page, so it is memoised: a page turn
 * redraws only the two labels.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors, fonts } from '@/constants/theme';
import { ar } from '@/mushaf/quran';

export const TEXT_W = 340;
export const TEXT_H = 588;

const TEAL = colors.primaryTeal;
const BRASS = colors.accentBrassMuted;
const BRASS_SOFT = colors.accentBrassSoft;
const BAND_FILL = '#f1e6cb';
const SHEET = '#fcf8ee';
const CARTOUCHE = '#f6edd7';

export type SheetGeometry = {
  /** Ornamental band width. */
  band: number;
  /** Space between the band and the text box. */
  padX: number;
  padY: number;
  /** The sura | juz strip above the frame, and the gap under it. */
  header: number;
  gap: number;
  /** Room under the frame for the page-number medallion's overhang. */
  foot: number;
  frameW: number;
  frameH: number;
  sheetW: number;
  sheetH: number;
  /** Scale from logical units to screen dp. */
  k: number;
  compact: boolean;
};

const SIDE = 5; // dp between the sheet and the screen edge
const VPAD = 6;

function geometry(compact: boolean): Omit<SheetGeometry, 'k'> {
  const g = compact
    ? { band: 9, padX: 8, padY: 10, header: 26, gap: 5, foot: 5 }
    : { band: 12, padX: 11, padY: 14, header: 28, gap: 7, foot: 6 };
  const frameW = TEXT_W + 2 * (g.band + g.padX);
  const frameH = TEXT_H + 2 * (g.band + g.padY);
  return { ...g, frameW, frameH, sheetW: frameW, sheetH: g.header + g.gap + frameH + g.foot, compact };
}

/**
 * Fit the whole sheet (strip + frame + medallion) into width×height dp,
 * keeping the page's proportions. Narrow screens get the slimmer margins so
 * the Quran text loses as little size as possible.
 */
export function sheetGeometry(width: number, height: number): SheetGeometry {
  const compact = width < 360;
  const g = geometry(compact);
  const k = Math.min((width - 2 * SIDE) / g.sheetW, (height - 2 * VPAD) / g.sheetH);
  return { ...g, k };
}

const UNITS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع'];

/** «الجزء الأول» … «الجزء الثلاثون». */
export function juzTitle(juz: number): string {
  let n: string;
  if (juz <= 9) n = UNITS[juz - 1];
  else if (juz === 10) n = 'العاشر';
  else if (juz < 20) n = `${juz === 11 ? 'الحادي' : UNITS[juz - 11]} عشر`;
  else if (juz === 20) n = 'العشرون';
  else if (juz < 30) n = `${juz === 21 ? 'الحادي' : UNITS[juz - 21]} والعشرون`;
  else n = 'الثلاثون';
  return `الجزء ${n}`;
}

// ---------- shapes ----------

/** An eight-point star (two squares) centred on (cx, cy). */
function star(cx: number, cy: number, r: number) {
  const pts = (rot: number) =>
    Array.from({ length: 4 }, (_, i) => {
      const a = rot + (i * Math.PI) / 2;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    });
  return `M${pts(0).join('L')}Z M${pts(Math.PI / 4).join('L')}Z`;
}

/** A cartouche with pointed ends, inset by i. */
function cartouche(x: number, y: number, w: number, h: number, p: number, i = 0) {
  const l = x + i;
  const r = x + w - i;
  const t = y + i;
  const b = y + h - i;
  const m = y + h / 2;
  const q = p - i * 0.4;
  return `M${l + q},${t} H${r - q} L${r},${m} L${r - q},${b} H${l + q} L${l},${m} Z`;
}

/** Diamonds and dots alternating along one band edge. */
function bandMotifs(x0: number, y0: number, x1: number, y1: number, size: number) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.floor(len / 9));
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  let diamonds = '';
  let dots = '';
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i;
    const y = y0 + dy * i;
    if (i % 2 === 0) diamonds += `M${x.toFixed(2)},${(y - size).toFixed(2)} L${(x + size).toFixed(2)},${y.toFixed(2)} L${x.toFixed(2)},${(y + size).toFixed(2)} L${(x - size).toFixed(2)},${y.toFixed(2)} Z `;
    else dots += `M${(x - 0.75).toFixed(2)},${y.toFixed(2)} a0.75,0.75 0 1,0 1.5,0 a0.75,0.75 0 1,0 -1.5,0 `;
  }
  return { diamonds, dots };
}

const FrameArt = memo(function FrameArt({ w, h, band }: { w: number; h: number; band: number }) {
  const c = band / 2; // band centre line
  const s = Math.max(1.8, band * 0.22);
  const start = band + 4;
  const edges = [
    bandMotifs(start, c, w - start, c, s),
    bandMotifs(start, h - c, w - start, h - c, s),
    bandMotifs(c, start, c, h - start, s),
    bandMotifs(w - c, start, w - c, h - start, s),
  ];
  const diamonds = edges.map((e) => e.diamonds).join('');
  const dots = edges.map((e) => e.dots).join('');
  const corners = [
    [c, c],
    [w - c, c],
    [c, h - c],
    [w - c, h - c],
  ];
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Rect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} rx={2} fill={BAND_FILL} stroke={TEAL} strokeWidth={1.5} />
      <Rect x={2.8} y={2.8} width={w - 5.6} height={h - 5.6} fill="none" stroke={BRASS} strokeWidth={0.6} />
      <Rect x={band - 2.4} y={band - 2.4} width={w - 2 * (band - 2.4)} height={h - 2 * (band - 2.4)} fill="none" stroke={BRASS} strokeWidth={0.6} />
      <Rect x={band} y={band} width={w - 2 * band} height={h - 2 * band} fill={SHEET} stroke={TEAL} strokeWidth={1} />
      <Path d={diamonds} fill={BRASS} opacity={0.85} />
      <Path d={dots} fill={TEAL} opacity={0.6} />
      {corners.map(([x, y], i) => (
        <Rect key={`t${i}`} x={x - c + 1.5} y={y - c + 1.5} width={band - 3} height={band - 3} fill={TEAL} />
      ))}
      {corners.map(([x, y], i) => (
        <Path key={i} d={star(x, y, band * 0.34)} fill={BRASS_SOFT} />
      ))}
      {corners.map(([x, y], i) => (
        <Circle key={`c${i}`} cx={x} cy={y} r={band * 0.1} fill={TEAL} />
      ))}
    </Svg>
  );
});

const HeaderArt = memo(function HeaderArt({ w, h, cw }: { w: number; h: number; cw: number }) {
  const m = h / 2;
  const p = h * 0.42;
  const left = 2;
  const right = w - 2 - cw;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Path d={`M${left + cw},${m} H${right}`} stroke={BRASS_SOFT} strokeWidth={0.8} />
      <Path d={`M${left + cw},${m - 2.5} H${right}`} stroke={BRASS_SOFT} strokeWidth={0.4} opacity={0.7} />
      <Path d={`M${left + cw},${m + 2.5} H${right}`} stroke={BRASS_SOFT} strokeWidth={0.4} opacity={0.7} />
      {[left, right].map((x) => (
        <Path key={`o${x}`} d={cartouche(x, 1, cw, h - 2, p)} fill={CARTOUCHE} stroke={TEAL} strokeWidth={1.1} />
      ))}
      {[left, right].map((x) => (
        <Path key={`i${x}`} d={cartouche(x, 1, cw, h - 2, p, 2.6)} fill="none" stroke={BRASS} strokeWidth={0.6} />
      ))}
      <Path d={star(w / 2, m, h * 0.26)} fill={BRASS} />
      <Circle cx={w / 2} cy={m} r={h * 0.09} fill={SHEET} />
    </Svg>
  );
});

const MEDAL_W = 52;
const MEDAL_H = 20;

const MedalArt = memo(function MedalArt() {
  return (
    <Svg width={MEDAL_W} height={MEDAL_H} style={StyleSheet.absoluteFill}>
      <Path d={cartouche(0.6, 0.6, MEDAL_W - 1.2, MEDAL_H - 1.2, 9)} fill={SHEET} stroke={TEAL} strokeWidth={1.1} />
      <Path d={cartouche(0.6, 0.6, MEDAL_W - 1.2, MEDAL_H - 1.2, 9, 2.4)} fill="none" stroke={BRASS} strokeWidth={0.6} />
    </Svg>
  );
});

/**
 * The full sheet in logical units (not yet scaled). `children` is the
 * untouched TEXT_W×TEXT_H text box.
 */
export function MushafSheet({
  geo,
  page,
  suraTitle,
  juz,
  children,
}: {
  geo: SheetGeometry;
  page: number;
  suraTitle: string;
  juz: number;
  children: React.ReactNode;
}) {
  const cw = Math.round(geo.sheetW * 0.4);
  const frameTop = geo.header + geo.gap;
  const label = { width: cw, height: geo.header, lineHeight: geo.header - 2, fontSize: geo.compact ? 12.5 : 13.5 };
  return (
    <View style={{ width: geo.sheetW, height: geo.sheetH, transform: [{ scale: geo.k }] }}>
      <View style={{ width: geo.sheetW, height: geo.header }}>
        <HeaderArt w={geo.sheetW} h={geo.header} cw={cw} />
        {/* Reading order: the sura first (right in RTL), the juz after it. The
            art is symmetric, so start/end follow the layout direction. */}
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, label, { start: 2 }]}>
          {suraTitle}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, label, { end: 2 }]}>
          {juzTitle(juz)}
        </Text>
      </View>

      <View style={{ position: 'absolute', top: frameTop, left: 0, width: geo.frameW, height: geo.frameH }}>
        <FrameArt w={geo.frameW} h={geo.frameH} band={geo.band} />
        <View style={{ position: 'absolute', top: geo.band + geo.padY, left: geo.band + geo.padX, width: TEXT_W, height: TEXT_H }}>
          {children}
        </View>
        <View
          accessible
          accessibilityLabel={`صفحة ${page}`}
          style={[styles.medal, { left: (geo.frameW - MEDAL_W) / 2, top: geo.frameH - geo.band / 2 - MEDAL_H / 2 }]}
        >
          <MedalArt />
          <Text allowFontScaling={false} style={styles.medalText}>
            {ar(page)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    top: 0,
    textAlign: 'center',
    fontFamily: fonts.display,
    color: TEAL,
    includeFontPadding: false,
    paddingHorizontal: 14,
  },
  medal: { position: 'absolute', width: MEDAL_W, height: MEDAL_H, alignItems: 'center', justifyContent: 'center' },
  medalText: { fontFamily: fonts.display, fontSize: 12, lineHeight: 18, color: TEAL, includeFontPadding: false },
});
