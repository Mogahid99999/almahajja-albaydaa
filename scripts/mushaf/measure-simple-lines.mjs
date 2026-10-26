/**
 * Measure every line of the simplified (KFGQPC Hafs V22) fixed page and pick
 * its font size — layout only; the Quran text is read, never changed.
 *
 *   node scripts/mushaf/measure-simple-lines.mjs [--font 20] [--gap 3] [--write]
 *
 * Each word (and ayah-number marker) is drawn as its own <Text> in the app, so
 * a line's natural width = Σ word widths + gap × (tokens − 1). Words are
 * measured with Chromium's text shaper (Playwright) on the bundled TTF at
 * 100px. Lines wider than the page get ONE uniform shrink (never squeezed
 * glyphs, never words moved between lines) — the same rule the app applies.
 * Without --write it only prints statistics; --write updates fx + shrink in
 * src/mushaf/data/layout.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const FONT = arg('--font', 17);
const GAP = arg('--gap', 4);
const WIDTH = 340;
const MARGIN = 0.985;

const layoutFile = path.join(root, 'src/mushaf/data/layout.json');
const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
const text = fs.readFileSync(path.join(root, 'assets/mushaf/hafs-v22.txt'), 'utf8').split(/\r?\n/);
if (text[text.length - 1] === '') text.pop();
if (text.length !== 6236) throw new Error('text');
const font = fs.readFileSync(path.join(root, 'assets/fonts/UthmanicHafs_V22.ttf')).toString('base64');

// Same helpers as src/mushaf/quran.ts.
const S = layout.S;
const suraOf = (g) => { let s = 0; while (s + 1 < S.length && S[s + 1][0] <= g) s++; return s; };
const AR = '٠١٢٣٤٥٦٧٨٩';
const ar = (n) => String(n).replace(/\d/g, (d) => AR[+d]);
const tokens = (raw) => (raw ? raw.split(' ') : []).flatMap((t) => {
  if (t[0] === '#') { const g = +t.slice(1); return [ar(g - S[suraOf(g)][0] + 1)]; }
  const [g, from, to] = t.split('.').map(Number);
  return text[g].split(' ').slice(from, to + 1);
});

const pages = layout.L.map((p) => p.split('|').map(tokens));
const unique = [...new Set(pages.flat(2))];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>@font-face{font-family:H;src:url(data:font/ttf;base64,${font})}</style><span style="font-family:H">ا</span>`);
const widths = await page.evaluate(async (words) => {
  await document.fonts.load('100px H');
  const c = document.createElement('canvas').getContext('2d');
  c.font = '100px H';
  return words.map((w) => c.measureText(w).width);
}, unique);
await browser.close();
const W = new Map(unique.map((w, i) => [w, widths[i]]));

const shrink = {};
let tightest = 1;
pages.forEach((lines, pi) => lines.forEach((ws, li) => {
  if (!ws.length) return;
  const nat = ws.reduce((a, w) => a + W.get(w), 0) * FONT / 100 + GAP * (ws.length - 1);
  if (nat > WIDTH * MARGIN) {
    const k = +((WIDTH * MARGIN) / nat).toFixed(3);
    shrink[`${pi + 1}.${li + 1}`] = k;
    tightest = Math.min(tightest, k);
  }
}));
const n = Object.keys(shrink).length;
const sizes = Object.values(shrink).map((k) => k * FONT);
console.log(JSON.stringify({
  font: FONT, gap: GAP, shrunkLines: n,
  smallestLineFont: +(tightest * FONT).toFixed(2),
  linesBelow: { [FONT - 1]: sizes.filter((s) => s < FONT - 1).length, [FONT - 2]: sizes.filter((s) => s < FONT - 2).length },
}));

if (process.argv.includes('--write')) {
  layout.fx = { width: WIDTH, font: FONT, gap: GAP, margin: MARGIN };
  layout.shrink = shrink;
  fs.writeFileSync(layoutFile, JSON.stringify(layout));
  console.log('layout.json updated');
}
