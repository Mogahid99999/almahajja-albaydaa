/**
 * Build the mushaf data SHIPPED WITH THE APP (text asset, Hafs font, page model).
 * The downloadable Madinah print pack is built separately (build-mushaf-pack.mjs).
 *
 *   node scripts/mushaf/build-mushaf-data.mjs <qdlDir>
 *
 * <qdlDir> holds the inputs gathered during the design phase:
 *   hafs_v22.json          KFGQPC «UthmanicHafs v22.json» (the ONLY text source)
 *   uthmanic_hafs_v22.ttf  KFGQPC Hafs V22 font (unmodified)
 *   mapped.json            V22 tokens → page/line (built by the validated mapper)
 *   quran-data.js          Tanzil metadata (sura names/lengths, page + juz starts)
 *   widths.json            Chrome-shaped natural line widths of the V22 font @100px
 * Writes (repo):
 *   data/quran/hafs-v22.source.json  verbatim copy of the source (test reference)
 *   assets/mushaf/hafs-v22.txt       one ayah per line, text byte-identical to source
 *   assets/fonts/UthmanicHafs_V22.ttf
 *   src/mushaf/data/layout.json      page model: lines reference V22 tokens by index
 *
 * The page model never contains Quran text — only indices into the V22 text —
 * so the displayed words can only ever be the official tokens.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [qdl] = process.argv.slice(2);
if (!qdl) {
  console.error('usage: build-mushaf-data.mjs <qdlDir>');
  process.exit(1);
}
const N = 604;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

// ---------- inputs ----------
const srcBuf = fs.readFileSync(path.join(qdl, 'hafs_v22.json'));
const V22 = JSON.parse(srcBuf.toString('utf8')).map((r) => r[0]);
if (V22.length !== 6236) fail('expected 6236 ayat, got ' + V22.length);
const M = JSON.parse(fs.readFileSync(path.join(qdl, 'mapped.json'), 'utf8'));
const QD = new Function(fs.readFileSync(path.join(qdl, 'quran-data.js'), 'utf8') + ';return QuranData;')();
const S0 = QD.Sura.slice(1, 115);
const gi = (s, v) => (s > 114 ? 6236 : S0[s - 1][0] + v - 1);
const S = S0.map((s) => [s[0], s[1], s[4], s[7] === 'Meccan' ? 0 : 1]);
const P = QD.Page.slice(1, N + 1).map(([s, v]) => gi(s, v));
const J = QD.Juz.slice(1, 31).map(([s, v]) => gi(s, v));
const W100 = JSON.parse(fs.readFileSync(path.join(qdl, 'widths.json'), 'utf8'));

// ---------- validate the mapping: every V22 token exactly once, in order ----------
const seen = Array.from({ length: 6236 }, () => []);
let order = -1, orderOk = true, ends = 0;
for (const lines of M) for (const ln of lines) for (const t of ln) {
  if (t.length === 2) { seen[t[0]].push(t[1]); if (t[0] < order) orderOk = false; order = t[0]; }
  else ends++;
}
let exact = 0;
for (let g = 0; g < 6236; g++) {
  const toks = V22[g].split(' ');
  const ix = seen[g];
  if (ix.length === toks.length && ix.every((v, k) => v === k) && ix.map((i) => toks[i]).join(' ') === V22[g]) exact++;
}
if (exact !== 6236 || !orderOk || ends !== 6236) fail(`mapping: exact ${exact}/6236, order ${orderOk}, end marks ${ends}`);

// ---------- page model (token ranges) ----------
const L = M.map((lines) => lines.map((ln) => {
  const out = [];
  for (const t of ln) {
    if (t.length === 1) { out.push('#' + t[0]); continue; }
    const last = out[out.length - 1];
    const m = last && /^(\d+)\.(\d+)\.(\d+)$/.exec(last);
    if (m && +m[1] === t[0] && +m[3] === t[1] - 1) out[out.length - 1] = `${m[1]}.${m[2]}.${t[1]}`;
    else out.push(`${t[0]}.${t[1]}.${t[1]}`);
  }
  return out.join(' ');
}).join('|'));

// Fixed-page fitting for the V22 font: logical page width 340, font 19px, 2px min
// gap (owner: 17px read small with wide gaps). Lines whose natural width exceeds
// the line get ONE uniform shrink factor (glyphs are never squeezed; words are
// never moved to another line). scripts/mushaf/measure-simple-lines.mjs
// re-measures and rewrites fx + shrink on its own (Chromium shaping, same rule).
const FX = { width: 340, font: 19, gap: 2, margin: 0.985 };
const shrink = {};
W100.lines.forEach((lines, pi) => lines.forEach((x, li) => {
  if (!x) return;
  const nat = (x[0] * FX.font) / 100 + FX.gap * (x[1] - 1);
  if (nat > FX.width * FX.margin) shrink[`${pi + 1}.${li + 1}`] = +((FX.width * FX.margin) / nat).toFixed(3);
}));

// ---------- repo outputs ----------
const w = (rel, data) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
w('data/quran/hafs-v22.source.json', srcBuf);
const txt = V22.join('\n') + '\n';
w('assets/mushaf/hafs-v22.txt', txt);
w('assets/fonts/UthmanicHafs_V22.ttf', fs.readFileSync(path.join(qdl, 'uthmanic_hafs_v22.ttf')));
const layout = { v: 1, fx: FX, S, P, J, L, shrink };
w('src/mushaf/data/layout.json', JSON.stringify(layout));
console.log(JSON.stringify({
  sourceSha256: sha256(srcBuf), textSha256: sha256(Buffer.from(txt, 'utf8')),
  ayat: V22.length, exact, shrunkLines: Object.keys(shrink).length,
  layoutBytes: Buffer.byteLength(JSON.stringify(layout)),
}));
