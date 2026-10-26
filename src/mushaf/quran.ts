/**
 * The mushaf page model — pure, no I/O.
 *
 * `data/layout.json` (scripts/mushaf/build-mushaf-data.mjs) holds, per page,
 * the Madinah 15-line layout as REFERENCES into the KFGQPC Hafs V22 text
 * (ayah index + token range), never text itself. The words a reader sees are
 * therefore always the official tokens from assets/mushaf/hafs-v22.txt;
 * nothing here alters, reorders or normalises Quran text. `fold` is used only
 * for matching sura names in search.
 */
import layout from './data/layout.json';

export const PAGE_COUNT = 604;
export const AYAH_COUNT = 6236;

/** [first global ayah index, ayah count, name, 1 = مدنية] per sura (114). */
export const SURAS = layout.S as [number, number, string, number][];
/** First global ayah index of each page (604) / juz (30). */
const PAGE_START = layout.P as number[];
const JUZ_START = layout.J as number[];
const PAGE_LINES = layout.L as string[];
/** V22 fixed-page geometry + per-line uniform shrink (overlong lines only). */
export const FIXED = layout.fx as { width: number; font: number; gap: number };
const SHRINK = layout.shrink as Record<string, number>;

export const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const ar = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);
export const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

/** Last index i with f(arr[i]) <= x (arr sorted ascending). */
function lastAtOrBefore<T>(arr: T[], x: number, f: (v: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (f(arr[m]) <= x) lo = m;
    else hi = m - 1;
  }
  return lo;
}
const id = (v: number) => v;

/** 0-based sura index of a global ayah index. */
export const suraOfAyah = (g: number) => lastAtOrBefore(SURAS, g, (s) => s[0]);
/** 1-based page of a global ayah index. */
export const pageOfAyah = (g: number) => lastAtOrBefore(PAGE_START, g, id) + 1;
/** 1-based juz of a global ayah index. */
export const juzOfAyah = (g: number) => lastAtOrBefore(JUZ_START, g, id) + 1;
/** Ayah number within its sura. */
export const ayahNumber = (g: number) => g - SURAS[suraOfAyah(g)][0] + 1;

export const suraName = (s: number) => SURAS[s][2];
export const suraStartPage = (s: number) => pageOfAyah(SURAS[s][0]);
export const juzStartPage = (j: number) => pageOfAyah(JUZ_START[j - 1]);

/** The sura + juz a page opens with (what the reader bar and index show). */
export function pageInfo(page: number) {
  const g = PAGE_START[page - 1];
  const s = suraOfAyah(g);
  return { sura: s, suraName: SURAS[s][2], juz: juzOfAyah(g) };
}

export const clampPage = (p: number) => Math.min(PAGE_COUNT, Math.max(1, Math.round(p) || 1));

// ---------- page lines ----------

/** A run of V22 tokens [from..to] of ayah g, or an ayah-end marker. */
export type Token = { k: 'w'; g: number; from: number; to: number } | { k: 'n'; g: number };
export type Line =
  | { t: 'x'; tokens: Token[]; shrink: number }
  | { t: 'h'; sura: number }
  | { t: 'b' }
  | { t: 'e' };

function parseLine(raw: string): Token[] {
  if (!raw) return [];
  return raw.split(' ').map((t) => {
    if (t[0] === '#') return { k: 'n', g: +t.slice(1) } as Token;
    const [g, from, to] = t.split('.').map(Number);
    return { k: 'w', g, from, to } as Token;
  });
}

/** 1-based sura number when the line's first token opens a sura, else 0. */
function suraStartOf(tokens: Token[]): number {
  const t = tokens[0];
  if (!t || t.k !== 'w' || t.from !== 0) return 0;
  const s = suraOfAyah(t.g);
  return SURAS[s][0] === t.g ? s + 1 : 0;
}

const rawLines = (p: number) => PAGE_LINES[p - 1].split('|').map(parseLine);

/** Number of Quran words on a printed page (ayah markers excluded). */
export function pageWordCount(p: number): number {
  let n = 0;
  for (const line of rawLines(clampPage(p))) {
    for (const t of line) if (t.k === 'w') n += t.to - t.from + 1;
  }
  return n;
}

/**
 * The 15 lines of a page. Empty layout lines are a sura header or the basmala:
 * a run of two before a sura start = header + basmala; at the top of a page a
 * single empty line before a sura = basmala (its header closed the previous
 * page); الفاتحة (its basmala is ayah 1) and التوبة (none) get a header only.
 * An empty run at the very bottom belongs to the sura opening the next page.
 */
export function pageLines(p: number): Line[] {
  const raw = rawLines(p);
  const out: Line[] = raw.map((tokens, i) =>
    tokens.length ? { t: 'x', tokens, shrink: SHRINK[`${p}.${i + 1}`] ?? 1 } : { t: 'e' },
  );
  for (let k = 0; k < 15; ) {
    if (raw[k].length) {
      k++;
      continue;
    }
    let e = k;
    while (e < 15 && !raw[e].length) e++;
    const run = e - k;
    let s = e < 15 ? suraStartOf(raw[e]) : 0;
    let nextLine1 = 0;
    if (e === 15 && p < PAGE_COUNT) {
      const nx = rawLines(p + 1);
      s = suraStartOf(nx[0]);
      if (!s && !nx[0].length && nx[1].length) nextLine1 = suraStartOf(nx[1]);
    }
    if (s > 0) {
      if (run >= 2 && s !== 1 && s !== 9) {
        out[e - 2] = { t: 'h', sura: s - 1 };
        out[e - 1] = { t: 'b' };
      } else if (run === 1 && k === 0 && s !== 1 && s !== 9) out[k] = { t: 'b' };
      else out[e - 1] = { t: 'h', sura: s - 1 };
    } else if (nextLine1 > 0 && run >= 1) {
      out[e - 1] = { t: 'h', sura: nextLine1 - 1 };
    }
    k = e;
  }
  return out;
}

/** Pages 1–2 are the short, centred opening pages. */
export const isOpeningPage = (p: number) => p <= 2;

/** Words of a token run, straight from the V22 text (split on its own spaces). */
export function tokenWords(text: readonly string[], t: Extract<Token, { k: 'w' }>): string[] {
  return text[t.g].split(' ').slice(t.from, t.to + 1);
}

// ---------- search ----------

/** Letters-only fold for matching sura names (search only — never displayed). */
export function fold(s: string): string {
  return s
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/^سوره\s*/, '')
    .trim();
}

export type SearchHit =
  | { kind: 'page'; page: number }
  | { kind: 'sura'; sura: number; page: number }
  | { kind: 'juz'; juz: number; page: number };

/** Live search: a number → page / sura / juz with that number; text → sura names. */
export function searchMushaf(query: string): SearchHit[] {
  const q = toLatinDigits(query.trim());
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const n = +q;
    const hits: SearchHit[] = [];
    if (n >= 1 && n <= PAGE_COUNT) hits.push({ kind: 'page', page: n });
    if (n >= 1 && n <= 114) hits.push({ kind: 'sura', sura: n - 1, page: suraStartPage(n - 1) });
    if (n >= 1 && n <= 30) hits.push({ kind: 'juz', juz: n, page: juzStartPage(n) });
    return hits;
  }
  const f = fold(query);
  if (!f) return [];
  return SURAS.map((s, i) => [s, i] as const)
    .filter(([s]) => fold(s[2]).includes(f))
    .slice(0, 12)
    .map(([, i]) => ({ kind: 'sura', sura: i, page: suraStartPage(i) }));
}
