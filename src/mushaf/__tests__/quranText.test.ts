/**
 * Quran text integrity — the guard against ever shipping text that differs
 * from the approved source.
 *
 * Source of truth: KFGQPC «UthmanicHafs v22.json» (data/quran/hafs-v22.source.json,
 * from github.com/nuqayah/qpc-fonts text-mushafs/UthmanicHafs_V22), pinned by
 * SHA-256. Everything the app displays must be derivable from it byte-for-byte:
 *   - the shipped asset assets/mushaf/hafs-v22.txt (one ayah per line),
 *   - the page model src/mushaf/data/layout.json, which may only REFERENCE
 *     tokens of that text (6236/6236 ayat rebuilt exactly, every word once, in order),
 *   - the bundled KFGQPC Hafs V22 font, which must stay unmodified.
 * If any of these assertions fails, do not ship: rebuild with
 * scripts/mushaf/build-mushaf-data.mjs from the official files.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import layout from '../data/layout.json';
import { AYAH_COUNT, PAGE_COUNT, pageLines, tokenWords, type Token } from '../quran';

const root = join(__dirname, '..', '..', '..');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const SOURCE_SHA256 = 'b5f9c469702154ad8764150a874ee3353f014dd84e233d28d6db74e54226275a';
const ASSET_SHA256 = '9632438840745afe2309390bdb25da73a7a2d0ca5d3427f2ba8641acf06c7f31';
const FONT_SHA256 = 'a6e59510dcaf3ec99db49427321a035ed94af555ffc7d27e7f430b5fd5e179f8';

const sourceBuf = readFileSync(join(root, 'data/quran/hafs-v22.source.json'));
const source = (JSON.parse(sourceBuf.toString('utf8')) as [string, number][]).map((r) => r[0]);
const assetBuf = readFileSync(join(root, 'assets/mushaf/hafs-v22.txt'));
const asset = assetBuf.toString('utf8').split('\n');
if (asset[asset.length - 1] === '') asset.pop();

describe('Quran text: source and shipped asset', () => {
  it('the reference file is the pinned KFGQPC Hafs V22 source', () => {
    expect(sha256(sourceBuf)).toBe(SOURCE_SHA256);
    expect(source).toHaveLength(AYAH_COUNT);
  });

  it('the shipped text asset is the source, ayah for ayah, byte for byte', () => {
    expect(asset).toHaveLength(AYAH_COUNT);
    const mismatches = asset.filter((line, i) => line !== source[i]).length;
    expect(mismatches).toBe(0);
    expect(sha256(assetBuf)).toBe(ASSET_SHA256);
  });

  it('the bundled KFGQPC Hafs font is unmodified', () => {
    expect(sha256(readFileSync(join(root, 'assets/fonts/UthmanicHafs_V22.ttf')))).toBe(FONT_SHA256);
  });
});

describe('Quran text: the page model only references the source', () => {
  const words = (t: Extract<Token, { k: 'w' }>) => tokenWords(source, t);

  it('has 604 pages of 15 lines', () => {
    expect(layout.L).toHaveLength(PAGE_COUNT);
    for (const p of layout.L as string[]) expect(p.split('|')).toHaveLength(15);
  });

  it('rebuilds all 6236 ayat exactly — no missing, extra, duplicated or reordered words', () => {
    const rebuilt: string[][] = Array.from({ length: AYAH_COUNT }, () => []);
    const ends = new Array<number>(AYAH_COUNT).fill(0);
    let lastAyah = -1;
    let ordered = true;
    for (let p = 1; p <= PAGE_COUNT; p++) {
      for (const line of pageLines(p)) {
        if (line.t !== 'x') continue;
        for (const t of line.tokens) {
          if (t.g < lastAyah) ordered = false;
          lastAyah = t.g;
          if (t.k === 'n') ends[t.g]++;
          else rebuilt[t.g].push(...words(t));
        }
      }
    }
    const exact = rebuilt.filter((w, g) => w.join(' ') === source[g]).length;
    expect(ordered).toBe(true);
    expect(exact).toBe(AYAH_COUNT);
    expect(ends.every((n) => n === 1)).toBe(true);
  });

  it('places 114 sura headers and 112 basmalas (none for الفاتحة\'s ayah 1 or التوبة)', () => {
    let headers = 0;
    let basmalas = 0;
    const headed = new Set<number>();
    for (let p = 1; p <= PAGE_COUNT; p++) {
      for (const l of pageLines(p)) {
        if (l.t === 'h') {
          headers++;
          headed.add(l.sura);
        }
        if (l.t === 'b') basmalas++;
      }
    }
    expect(headers).toBe(114);
    expect(headed.size).toBe(114);
    expect(basmalas).toBe(112);
  });

  it('contains no Quran text of its own (references only)', () => {
    const raw = JSON.stringify(layout.L);
    expect(/[؀-ۿ]/.test(raw)).toBe(false);
  });
});
