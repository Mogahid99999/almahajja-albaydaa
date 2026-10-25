/**
 * Build the downloadable Madinah print pack (self-contained, reproducible):
 *
 *   node scripts/mushaf/build-mushaf-pack.mjs <workDir>
 *
 * 1. fetches the 604 KFGQPC Madinah page fonts (QCF v1, 1405 print, unmodified)
 *    and every word's glyph code + line (quran.com API v4, code_v1/line_number);
 * 2. cross-checks each page against the committed page model
 *    (src/mushaf/data/layout.json): the same lines carry words, and every line
 *    has the same number of ayah-end markers — so print mode and the
 *    simplified/enlarged modes always show the same page;
 * 3. measures every line (glyph advances, parsed from the fonts) and records a
 *    uniform shrink for the few lines wider than the page;
 * 4. writes <workDir>/pack/<version>/{p001.ttf.gz…p604.ttf.gz, glyphs.json.gz, manifest.json}
 *    — gzip for transport only; the manifest holds each file's gz size, raw
 *    size and the raw file's MD5, which the app verifies before use.
 * Then upload with scripts/mushaf/upload-pack.mjs.
 * Downloads are cached in <workDir>, so re-runs resume.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const PACK_VERSION = 'madinah-1405-v1';
const N = 604;
const FONT_URL = (n) => `https://raw.githubusercontent.com/nuqayah/qpc-fonts/master/mushaf/QCF_P${n}.TTF`;
const API_URL = (p) =>
  `https://api.quran.com/api/v4/verses/by_page/${p}?words=true&word_fields=code_v1,line_number,v1_page&fields=&per_page=300`;
const QX = { width: 340, font: 21, gap: 2 };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = process.argv[2];
if (!work) {
  console.error('usage: build-mushaf-pack.mjs <workDir>');
  process.exit(1);
}
const fail = (m) => {
  console.error('FAIL:', m);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (p) => String(p).padStart(3, '0');
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(work, 'api'), { recursive: true });

async function fetchRetry(url, asJson) {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(String(r.status));
      return asJson ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch {
      await sleep(1500 * (t + 1));
    }
  }
  fail('download ' + url);
}

async function pool(n, items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// ---------- 1. sources ----------
const pages = Array.from({ length: N }, (_, i) => i + 1);
await pool(6, pages, async (p) => {
  const f = path.join(work, 'fonts', `QCF_P${pad(p)}.TTF`);
  if (!fs.existsSync(f) || fs.statSync(f).size < 1000) fs.writeFileSync(f, await fetchRetry(FONT_URL(pad(p))));
  const a = path.join(work, 'api', `${p}.json`);
  if (!fs.existsSync(a)) {
    const d = await fetchRetry(API_URL(p), true);
    const slim = d.verses.map((v) => [v.verse_key, v.words.map((w) => [w.line_number, w.char_type_name === 'end' ? 1 : 0, w.code_v1, w.v1_page])]);
    fs.writeFileSync(a, JSON.stringify(slim));
  }
});

// ---------- minimal TTF metrics (cmap format 4 + hmtx) ----------
function ttfMetrics(buf) {
  const tables = {};
  const num = buf.readUInt16BE(4);
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const upm = buf.readUInt16BE(tables.head + 18);
  const nH = buf.readUInt16BE(tables.hhea + 34);
  const adv = (gid) => buf.readUInt16BE(tables.hmtx + 4 * Math.min(gid, nH - 1));
  const cmap = tables.cmap;
  let sub = -1;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const r = cmap + 4 + i * 8;
    if (buf.readUInt16BE(r) === 3 && buf.readUInt16BE(r + 2) === 1) sub = cmap + buf.readUInt32BE(r + 4);
  }
  if (sub < 0 || buf.readUInt16BE(sub) !== 4) fail('cmap format 4 not found');
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  const glyphOf = (c) => {
    for (let s = 0; s < segX2 / 2; s++) {
      if (buf.readUInt16BE(ends + 2 * s) < c) continue;
      const start = buf.readUInt16BE(starts + 2 * s);
      if (start > c) return 0;
      const delta = buf.readInt16BE(deltas + 2 * s);
      const ro = buf.readUInt16BE(ranges + 2 * s);
      if (!ro) return (c + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + 2 * s + ro + 2 * (c - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  return { em: (str) => [...str].reduce((a, ch) => a + adv(glyphOf(ch.codePointAt(0))) / upm, 0) };
}

// ---------- 2 + 3. align with the committed page model, measure ----------
const layout = JSON.parse(fs.readFileSync(path.join(root, 'src/mushaf/data/layout.json'), 'utf8'));
const glyphPages = [];
const shrink = {};
for (const p of pages) {
  const lines = Array.from({ length: 15 }, () => []);
  const ends = Array(15).fill(0);
  for (const [, ws] of JSON.parse(fs.readFileSync(path.join(work, 'api', `${p}.json`), 'utf8'))) {
    for (const [ln, isEnd, code, v1p] of ws) {
      if (v1p !== p) fail(`page ${p}: a word belongs to page ${v1p}`);
      lines[ln - 1].push(code);
      if (isEnd) ends[ln - 1]++;
    }
  }
  const model = layout.L[p - 1].split('|');
  model.forEach((ln, i) => {
    if (!!ln !== lines[i].length > 0) fail(`page ${p} line ${i + 1}: words on one side only`);
    const marks = ln ? ln.split(' ').filter((t) => t[0] === '#').length : 0;
    if (marks !== ends[i]) fail(`page ${p} line ${i + 1}: ayah markers ${marks} ≠ ${ends[i]}`);
  });
  const m = ttfMetrics(fs.readFileSync(path.join(work, 'fonts', `QCF_P${pad(p)}.TTF`)));
  lines.forEach((l, i) => {
    if (!l.length) return;
    const nat = l.reduce((a, w) => a + m.em(w), 0) * QX.font + QX.gap * (l.length - 1);
    if (nat > QX.width) shrink[`${p}.${i + 1}`] = +(QX.width / nat).toFixed(3);
  });
  glyphPages.push(lines.map((l) => l.join(' ')));
}

// ---------- 4. pack ----------
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const dir = path.join(work, 'pack', PACK_VERSION);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const files = [];
const put = (name, raw) => {
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(path.join(dir, name + '.gz'), gz);
  files.push({ name, path: name + '.gz', size: gz.length, raw: raw.length, md5: md5(raw) });
};
put('glyphs.json', Buffer.from(JSON.stringify({ v: 1, fx: QX, shrink, pages: glyphPages }), 'utf8'));
for (const p of pages) put(`p${pad(p)}.ttf`, fs.readFileSync(path.join(work, 'fonts', `QCF_P${pad(p)}.TTF`)));
const manifest = {
  version: PACK_VERSION,
  createdAt: new Date().toISOString(),
  totalSize: files.reduce((a, f) => a + f.size, 0),
  totalRaw: files.reduce((a, f) => a + f.raw, 0),
  files,
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
console.log(JSON.stringify({ pack: dir, files: files.length, totalSize: manifest.totalSize, totalRaw: manifest.totalRaw, shrunkLines: Object.keys(shrink).length }));
