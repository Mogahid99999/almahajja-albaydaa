/**
 * «الحلقة» — the live room board as PURE geometry (PLAN_LIVE_V23 §1.1 items 2–3,
 * §7.3, §7.4). No React, no react-native-svg, no I/O: counts plus a few special
 * participants in, positioned slots for ONE SVG board out. `Halaqa.tsx` draws;
 * this file decides where everything sits.
 *
 * A port of the approved prototype's geometry. The prototype board is 390×410
 * with viewBox "-195 -205 390 410" (centre at board px 195,205); everything here
 * is computed in those design units and scaled to `size` = board width in px.
 *
 * ── The board (design units, outward from the centre) ───────────────────────
 *   medallion  the sheikh: 8-point star (outer 43 / inner 35, rot 22.5°),
 *              core circle 25, inside an 88×88 box
 *   front arc  r 62, dashed — brothers who speak / moderate (28 px icons)
 *   brothers   rows r 90 · 107 · 124 · 141, a gap of ±17° at the top
 *   label      r 110 (brothers), r 174 (sisters) — curved zone labels
 *   hijab      r 156, lattice stroke 11 → 150.5 … 161.5 (thin border circles)
 *   sisters    rows r 171 · 186, a gap of ±14° at the top and deg 62…118 at
 *              the bottom; sisters who speak sit IN that bottom gap on r 171
 *   outer disc r 194 · ripple r 215 (centred on the speaker, or on the sheikh)
 *
 * ── Angles (the prototype's convention, used as-is) ─────────────────────────
 * Screen coordinates, y down:  x = r·cos(deg),  y = r·sin(deg).
 * deg −90 is the top and deg grows CLOCKWISE on screen (0 right, 90 bottom,
 * 180 left); seat angles lie in (−90, 270). The prototype is the approved RTL
 * rendering, so nothing is mirrored. Seats are numbered in generation order —
 * per section ring 0 first, and within a ring clockwise from the top gap — so
 * the FIRST seat of every row is just right of the top gap: the RTL start side.
 *
 * ── Rows and tiers (§7.4) ───────────────────────────────────────────────────
 * Each row gets n = floor(2πr / step) seats at deg = −90 + (i + ½)·360/n, minus
 * the gaps; coordinates are rounded to whole design units (as the prototype).
 *   regular  step 19, 15 px listeners: 137 brothers + 92 sisters = 229 seats
 *   compact  step 13, 12 px listeners: 201 brothers + 134 sisters = 335 seats —
 *            same radii, same hijab and front arc; 13 is the smallest step whose
 *            rounded seats stay ≥ 12 apart (12.5 → 344 seats but overlaps).
 * The board is regular while each section's listeners fit its free seats, else
 * compact. Beyond compact: the LAST filled seat of the section becomes a «+N»
 * chip (kind 'more', N = listeners − free seats + 1), so icons + N = count.
 *
 * ── Listeners ───────────────────────────────────────────────────────────────
 * n = min(listeners, free) listeners take the free seats {floor(i·free/n)} in
 * seat order — an even spread over ALL rows of the section. "Free" = not a
 * special's seat and not under a special's (larger) icon: the prototype drew
 * big specials over their neighbours; here those neighbours are left empty so
 * nothing overlaps.
 *
 * ── Specials (icon px on the 390 board: «أنت» 24, buddy 22, hand 22, front 28)
 *   host       the medallion (0,0). A SISTER hosting sits on the sisters' front
 *              (r 171, deg 90) instead — the hijab rule outranks the medallion.
 *   me         brothers row 1 at −35°, sisters row 0 at −40° (nearest free seat).
 *              Speaking/moderating puts «أنت» on the front: brothers 135°,
 *              sisters 90°. A raised hand never moves «أنت».
 *   moderators front, first come first served: brothers −45°; sisters 52°.
 *   speakers   front, first come first served: brothers 90, 45, 0, 180, 225;
 *              sisters 108, 72, 128. Then the default (brothers −135 = 225,
 *              sisters 52), then the rest of the arc (brothers every 45° except
 *              the top; sisters ±20° steps outward), then the nearest row seat.
 *   buddies    by list order: brothers #1 row 0 @120°, #2 row 3 @−140°, #3 row 2
 *              @60°; sisters #1 row 0 @200°, #2 row 1 @−120°, #3 row 1 @20°.
 *   hands      order-independent: a stable hash of the id picks the first of
 *              the preferred seats (brothers row1@205, row2@22, row0@160;
 *              sisters row0@150, row1@250), then the next preference, then a
 *              hashed seat anywhere in the section.
 * One person in several roles gets ONE slot: primary kind by precedence
 * host > me > moderator > speaker > buddy > hand, the rest listed in `also`.
 * Specials are placed in that order (hands last, by id), before any listener,
 * so a special's seat never depends on listener counts, and a raised hand can
 * never move «أنت», the front or a buddy. Row-seated specials shrink ×0.8 in the
 * compact tier; the front arc keeps 28 px.
 *
 * ── Counts ──────────────────────────────────────────────────────────────────
 * `brothers` / `sisters` = everyone present in that section, specials
 * included, the HOST EXCLUDED.
 *
 * ── Memoization (§7.4) ──────────────────────────────────────────────────────
 * `halaqaLayoutKey(input)` (= `layout.key`) changes only with the size, the
 * counts or the special placements: names, mic state and the active speaker are
 * not inputs. Moderators, speakers and buddies are first come first served, so
 * their ORDER is part of the key; the order of hands is not.
 */

export type HalaqaGender = 'm' | 'f';
export type HalaqaSection = 'brothers' | 'sisters';
export type HalaqaTier = 'regular' | 'compact';
export type HalaqaSlotKind =
  | 'listener'
  | 'speaker'
  | 'moderator'
  | 'me'
  | 'buddy'
  | 'hand'
  | 'host'
  /** The «+N» chip that stands in the last filled seat of an overflowing section. */
  | 'more';

/** A participant with a reserved place. Extra fields (name, mic…) are ignored. */
export type HalaqaPerson = { readonly id: string; readonly gender: HalaqaGender };

export type HalaqaInput = {
  /** Board width in px; the height follows the 390×410 board. */
  readonly size: number;
  /** Brothers present: host excluded, specials included. */
  readonly brothers: number;
  /** Sisters present: host excluded, specials included. */
  readonly sisters: number;
  readonly host?: HalaqaPerson | null;
  readonly me?: HalaqaPerson | null;
  /** Staff present other than the host, in arrival order. */
  readonly moderators?: readonly HalaqaPerson[];
  /** Approved speakers, in arrival order (first come, first served). */
  readonly speakers?: readonly HalaqaPerson[];
  /** My buddies present, in a stable order (#1, #2, #3). */
  readonly buddies?: readonly HalaqaPerson[];
  /** Raised hands; order does not matter. */
  readonly hands?: readonly HalaqaPerson[];
};

/** One row of seats. */
export type HalaqaRing = {
  readonly index: number;
  readonly section: HalaqaSection;
  /** 0 = the section's innermost row. */
  readonly row: number;
  readonly radius: number;
  /** Rug band: half a row pitch either side. */
  readonly inner: number;
  readonly outer: number;
  readonly seats: number;
};

/** The mashrabiya lattice ring between the sections. */
export type HalaqaHijab = {
  readonly radius: number;
  readonly width: number;
  readonly inner: number;
  readonly outer: number;
};

export type HalaqaMedallion = {
  /** Star outer / inner radius, core circle radius, bounding box edge. */
  readonly outer: number;
  readonly inner: number;
  readonly core: number;
  readonly box: number;
  /** Degrees, the prototype's starPts rotation. */
  readonly rotation: number;
};

export type HalaqaSizes = Readonly<{
  listener: number;
  me: number;
  buddy: number;
  hand: number;
  front: number;
}>;

export type HalaqaSlot = {
  /** Present for specials only; listeners are anonymous. */
  readonly id?: string;
  /** Centre, board px. */
  readonly x: number;
  readonly y: number;
  /** Degrees, the prototype's convention (see above). */
  readonly angle: number;
  readonly gender: HalaqaGender;
  readonly kind: HalaqaSlotKind;
  /** Index into `rings`; −1 = the medallion; −2 = a front place (not a row seat). */
  readonly ring: number;
  /** Icon edge in board px. */
  readonly size: number;
  /** Other roles of the same person (e.g. «أنت» with a raised hand). */
  readonly also?: readonly HalaqaSlotKind[];
  /** kind 'more': the N of «+N». */
  readonly more?: number;
};

export type HalaqaCounts = Readonly<Record<HalaqaSection, number>>;

export type HalaqaLayout = {
  readonly key: string;
  /** Board width in px (= input size). */
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** The design origin (0,0) in board px. */
  readonly cx: number;
  readonly cy: number;
  /** size / 390. */
  readonly scale: number;
  readonly tier: HalaqaTier;
  /** Listener icon edge in board px. */
  readonly iconSize: number;
  readonly sizes: HalaqaSizes;
  readonly medallion: HalaqaMedallion;
  /** The brothers' dashed front arc (the sisters' front is `rings` sisters row 0). */
  readonly frontRadius: number;
  readonly rings: readonly HalaqaRing[];
  readonly hijab: HalaqaHijab;
  readonly labelRadius: HalaqaCounts;
  readonly outerRadius: number;
  readonly rippleRadius: number;
  /** Host first, then the other specials, then listeners (brothers, sisters). */
  readonly slots: readonly HalaqaSlot[];
  /** Seats per section in this tier (before specials). */
  readonly capacity: HalaqaCounts;
  /** People not drawn as icons — the N of each section's «+N» chip (0 = none). */
  readonly overflow: HalaqaCounts;
};

// ─── The prototype's geometry (design units) ─────────────────────────────────

export const HALAQA_BOARD = { width: 390, height: 410, cx: 195, cy: 205 } as const;
export const HALAQA_REFERENCE_SIZE = HALAQA_BOARD.width;

const R_FRONT = 62;
const RB = [90, 107, 124, 141] as const;
const RS = [171, 186] as const;
const R_HIJAB = 156;
const HIJAB_STROKE = 11;
const R_LABEL = { brothers: 110, sisters: 174 } as const;
const R_OUTER = 194;
const R_RIPPLE = 215;
const MEDALLION: HalaqaMedallion = { outer: 43, inner: 35, core: 25, box: 88, rotation: 22.5 };
/** Top gap half-angle per section; the sisters' bottom gap (deg, inclusive). */
const TOP_GAP_HALF = [17, 14] as const;
const SISTER_BOTTOM_GAP = [62, 118] as const;

type TierSpec = { readonly step: number; readonly sizes: HalaqaSizes };
const FRONT_SIZE = 28;
const TIER_SPECS: Readonly<Record<HalaqaTier, TierSpec>> = {
  regular: { step: 19, sizes: { listener: 15, me: 24, buddy: 22, hand: 22, front: FRONT_SIZE } },
  // Row-seated specials ×0.8 like the listeners (15 → 12); the front arc keeps 28.
  compact: { step: 13, sizes: { listener: 12, me: 19.2, buddy: 17.6, hand: 17.6, front: FRONT_SIZE } },
};
/** Listener icon edge per tier on the 390 board. */
export const HALAQA_ICON: Readonly<Record<HalaqaTier, number>> = { regular: 15, compact: 12 };

const B = 0;
const S = 1;
type Sec = typeof B | typeof S;
const SECTIONS: readonly HalaqaSection[] = ['brothers', 'sisters'];
const GENDERS: readonly HalaqaGender[] = ['m', 'f'];

/** Front places, per section: own preferences first, then the default, then the arc. */
const FRONT_GRID: readonly [readonly number[], readonly number[]] = [
  [-45, 0, 45, 90, 135, 180, 225], // every 45° except the top (−90)
  [90, 108, 72, 128, 52, 148, 32, 168, 12, 188, -8, 208, -28, 228, -48, 248, -68],
];
const FRONT_DEFAULT: readonly [number, number] = [225, 52]; // brothers −135 ≡ 225
const FRONT_PREFS = {
  host: [[], [90]],
  me: [[135], [90]],
  moderator: [[-45], [52]],
  speaker: [[90, 45, 0, 180, 225], [108, 72, 128]],
} as const satisfies Record<string, readonly [readonly number[], readonly number[]]>;

type RowPref = readonly [row: number, deg: number];
const ME_SEAT: readonly [RowPref, RowPref] = [[1, -35], [0, -40]];
const BUDDY_SEATS: readonly [readonly RowPref[], readonly RowPref[]] = [
  [[0, 120], [3, -140], [2, 60]],
  [[0, 200], [1, -120], [1, 20]],
];
const HAND_SEATS: readonly [readonly RowPref[], readonly RowPref[]] = [
  [[1, 205], [2, 22], [0, 160]],
  [[0, 150], [1, 250]],
];

// ─── Seat grid (built once per tier) ─────────────────────────────────────────

type RowMeta = {
  readonly section: Sec;
  readonly row: number;
  readonly r: number;
  readonly pitch: number;
  readonly first: number;
  readonly count: number;
};

type Geom = {
  readonly tier: HalaqaTier;
  readonly spec: TierSpec;
  readonly rows: readonly RowMeta[];
  /** First global ring index of each section. */
  readonly rowBase: readonly [number, number];
  /** Per seat (global id = generation order, brothers first). */
  readonly seatX: Int16Array;
  readonly seatY: Int16Array;
  readonly seatDeg: Float64Array;
  readonly seatRing: Int8Array;
  readonly secStart: readonly [number, number];
  readonly secEnd: readonly [number, number];
  /** Scratch, per call: a special sits here / a special's icon covers it. */
  readonly reserved: Uint8Array;
  readonly blocked: Uint8Array;
};

function buildGeom(tier: HalaqaTier): Geom {
  const spec = TIER_SPECS[tier];
  const xs: number[] = [];
  const ys: number[] = [];
  const degs: number[] = [];
  const rings: number[] = [];
  const rows: RowMeta[] = [];
  const addSection = (section: Sec, radii: readonly number[], keep: ((deg: number) => boolean) | null) => {
    const pitch = radii[1] - radii[0];
    radii.forEach((r, row) => {
      const first = xs.length;
      const n = Math.floor((2 * Math.PI * r) / spec.step);
      for (let i = 0; i < n; i++) {
        const deg = -90 + ((i + 0.5) * 360) / n;
        const rel = deg + 90;
        if (rel < TOP_GAP_HALF[section] || rel > 360 - TOP_GAP_HALF[section]) continue;
        if (keep && !keep(deg)) continue;
        const a = (deg * Math.PI) / 180;
        xs.push(Math.round(r * Math.cos(a)));
        ys.push(Math.round(r * Math.sin(a)));
        degs.push(round2(deg));
        rings.push(rows.length);
      }
      rows.push({ section, row, r, pitch, first, count: xs.length - first });
    });
  };
  addSection(B, RB, null);
  const bEnd = xs.length;
  addSection(S, RS, (deg) => deg < SISTER_BOTTOM_GAP[0] || deg > SISTER_BOTTOM_GAP[1]);
  return {
    tier,
    spec,
    rows,
    rowBase: [0, RB.length],
    seatX: Int16Array.from(xs),
    seatY: Int16Array.from(ys),
    seatDeg: Float64Array.from(degs),
    seatRing: Int8Array.from(rings),
    secStart: [0, bEnd],
    secEnd: [bEnd, xs.length],
    reserved: new Uint8Array(xs.length),
    blocked: new Uint8Array(xs.length),
  };
}

const GEOMS: { regular?: Geom; compact?: Geom } = {};
function geomOf(tier: HalaqaTier): Geom {
  let g = GEOMS[tier];
  if (!g) {
    g = buildGeom(tier);
    GEOMS[tier] = g;
  }
  return g;
}

/** Seats per section in a tier. */
export function halaqaCapacity(tier: HalaqaTier): HalaqaCounts {
  const g = geomOf(tier);
  return { brothers: g.secEnd[B] - g.secStart[B], sisters: g.secEnd[S] - g.secStart[S] };
}

// ─── Specials ────────────────────────────────────────────────────────────────

// Bit order = precedence: the lowest set bit is the primary kind.
const F_HOST = 1;
const F_ME = 2;
const F_MOD = 4;
const F_SPEAKER = 8;
const F_BUDDY = 16;
const F_HAND = 32;
const FLAG_KINDS: readonly (readonly [number, HalaqaSlotKind])[] = [
  [F_HOST, 'host'],
  [F_ME, 'me'],
  [F_MOD, 'moderator'],
  [F_SPEAKER, 'speaker'],
  [F_BUDDY, 'buddy'],
  [F_HAND, 'hand'],
];

type Special = {
  readonly id: string;
  readonly gender: HalaqaGender;
  flags: number;
  /** Position in the (deduped) buddies list, −1 if not a buddy. */
  buddyIndex: number;
};

type Plan = {
  readonly key: string;
  readonly host: Special | null;
  /** Non-host specials in placement order. */
  readonly order: readonly Special[];
  readonly inSection: readonly [number, number];
};

const primaryFlag = (flags: number) => flags & -flags;

function primaryKind(flags: number): HalaqaSlotKind {
  const p = primaryFlag(flags);
  for (const [flag, kind] of FLAG_KINDS) if (flag === p) return kind;
  return 'hand';
}

function alsoKinds(flags: number): HalaqaSlotKind[] | undefined {
  const rest = flags & ~primaryFlag(flags);
  if (!rest) return undefined;
  const out: HalaqaSlotKind[] = [];
  for (const [flag, kind] of FLAG_KINDS) if (rest & flag) out.push(kind);
  return out;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isPerson = (p: HalaqaPerson | null | undefined): p is HalaqaPerson =>
  !!p && typeof p.id === 'string' && p.id !== '' && (p.gender === 'm' || p.gender === 'f');

/** First occurrence of each valid person, in list order. */
function dedupe(list: readonly HalaqaPerson[] | undefined): HalaqaPerson[] {
  const seen = new Set<string>();
  const out: HalaqaPerson[] = [];
  for (const p of list ?? []) {
    if (isPerson(p) && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

const enc = (p: HalaqaPerson) => `${p.id.length}:${p.id}${p.gender}`;
const cleanCount = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const cleanSize = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

function makePlan(input: HalaqaInput, size: number, brothers: number, sisters: number): Plan {
  const host = isPerson(input.host) ? input.host : null;
  const me = isPerson(input.me) ? input.me : null;
  const moderators = dedupe(input.moderators);
  const speakers = dedupe(input.speakers);
  const buddies = dedupe(input.buddies);
  const hands = dedupe(input.hands).sort((a, b) => cmp(a.id, b.id));

  // Length-prefixed ids: unambiguous whatever the id contains.
  const key =
    `${size}|${brothers}|${sisters}|h${host ? enc(host) : ''}|m${me ? enc(me) : ''}` +
    `|M${moderators.map(enc).join(',')}|S${speakers.map(enc).join(',')}` +
    `|B${buddies.map(enc).join(',')}|R${hands.map(enc).join(',')}`;

  // The first role listed (by precedence) fixes a person's gender.
  const byId = new Map<string, Special>();
  const add = (p: HalaqaPerson, flag: number) => {
    const found = byId.get(p.id);
    if (found) found.flags |= flag;
    else byId.set(p.id, { id: p.id, gender: p.gender, flags: flag, buddyIndex: -1 });
  };
  if (host) add(host, F_HOST);
  if (me) add(me, F_ME);
  for (const p of moderators) add(p, F_MOD);
  for (const p of speakers) add(p, F_SPEAKER);
  buddies.forEach((p, i) => {
    add(p, F_BUDDY);
    byId.get(p.id)!.buddyIndex = i;
  });
  for (const p of hands) add(p, F_HAND);

  // Placement order: me, moderators, speakers, buddies (list order), hands (by id).
  const order: Special[] = [];
  const inSection: [number, number] = [0, 0];
  const queue = (list: readonly HalaqaPerson[], flag: number) => {
    for (const p of list) {
      const sp = byId.get(p.id)!;
      if (primaryFlag(sp.flags) !== flag) continue;
      order.push(sp);
      inSection[sp.gender === 'f' ? S : B]++;
    }
  };
  if (me) queue([me], F_ME);
  queue(moderators, F_MOD);
  queue(speakers, F_SPEAKER);
  queue(buddies, F_BUDDY);
  queue(hands, F_HAND);
  return { key, host: host ? byId.get(host.id)! : null, order, inSection };
}

/**
 * The memo key for a layout: size + counts + each special's id, gender and role;
 * the order of moderators, speakers and buddies (first come, first served), not
 * of hands. Extra person fields don't affect it.
 */
export function halaqaLayoutKey(input: HalaqaInput): string {
  const size = cleanSize(input.size);
  return makePlan(input, size, cleanCount(input.brothers), cleanCount(input.sisters)).key;
}

/** FNV-1a 32-bit — a stable preference per id. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ─── Placement ───────────────────────────────────────────────────────────────

type Placed = {
  readonly sp: Special;
  readonly sec: Sec;
  /** Design units. */
  readonly x: number;
  readonly y: number;
  readonly deg: number;
  readonly ring: number;
  readonly size: number;
};

type Attempt = {
  readonly placed: Placed[];
  readonly seated: [number, number];
  readonly free: [number, number];
};

/** Places every special on `geom`, then marks the seats listeners can't use. */
function attempt(geom: Geom, plan: Plan): Attempt {
  const { seatX, seatY, seatDeg, seatRing, reserved, blocked, rows, rowBase, secStart, secEnd } = geom;
  const sizes = geom.spec.sizes;
  reserved.fill(0);
  const placed: Placed[] = [];
  const seated: [number, number] = [0, 0];

  const fits = (x: number, y: number, size: number) => {
    for (const p of placed) {
      const need = (size + p.size) / 2;
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy < need * need) return false;
    }
    return true;
  };
  const seatFits = (g: number, size: number) => !reserved[g] && fits(seatX[g], seatY[g], size);

  /** Nearest seat of a row to `deg` (optionally only among seats that fit). */
  const nearestInRow = (ringIdx: number, deg: number, size: number, mustFit: boolean) => {
    const row = rows[ringIdx];
    let best = -1;
    let bestD = Infinity;
    for (let g = row.first; g < row.first + row.count; g++) {
      const d = angularDistance(seatDeg[g], deg);
      if (d < bestD && (!mustFit || seatFits(g, size))) {
        best = g;
        bestD = d;
      }
    }
    return best;
  };
  /** Nearest fitting seat to `deg`, innermost row first. */
  const nearestInSection = (sec: Sec, deg: number, size: number) => {
    for (let ri = rowBase[sec]; ri < rowBase[sec] + (sec === B ? RB.length : RS.length); ri++) {
      const g = nearestInRow(ri, deg, size, true);
      if (g >= 0) return g;
    }
    return -1;
  };
  /** First fitting seat of the section from a hashed start, in seat order. */
  const hashedInSection = (sec: Sec, h: number, size: number) => {
    const n = secEnd[sec] - secStart[sec];
    for (let i = 0; i < n; i++) {
      const g = secStart[sec] + ((h + i) % n);
      if (seatFits(g, size)) return g;
    }
    return -1;
  };

  const put = (sp: Special, sec: Sec, x: number, y: number, deg: number, ring: number, size: number) => {
    placed.push({ sp, sec, x, y, deg, ring, size });
  };
  const putSeat = (sp: Special, sec: Sec, g: number, size: number) => {
    reserved[g] = 1;
    put(sp, sec, seatX[g], seatY[g], seatDeg[g], seatRing[g], size);
  };
  /** Front: own preferences, the default, the rest of the arc, then a row seat. */
  const putFront = (sp: Special, sec: Sec, prefs: readonly number[]) => {
    const r = sec === B ? R_FRONT : RS[0];
    const size = sizes.front;
    const lists = [prefs, [FRONT_DEFAULT[sec]], FRONT_GRID[sec]];
    for (const list of lists) {
      for (const deg of list) {
        const a = (deg * Math.PI) / 180;
        const x = Math.round(r * Math.cos(a));
        const y = Math.round(r * Math.sin(a));
        if (fits(x, y, size)) return put(sp, sec, x, y, deg, -2, size);
      }
    }
    const g = nearestInSection(sec, prefs[0] ?? FRONT_DEFAULT[sec], size);
    if (g >= 0) putSeat(sp, sec, g, size);
  };
  const putRowPref = (sp: Special, sec: Sec, [row, deg]: RowPref, size: number) => {
    let g = nearestInRow(rowBase[sec] + row, deg, size, true);
    if (g < 0) g = nearestInSection(sec, deg, size);
    if (g >= 0) putSeat(sp, sec, g, size);
  };

  if (plan.host && plan.host.gender === 'f') putFront(plan.host, S, FRONT_PREFS.host[S]);
  for (const sp of plan.order) {
    const sec: Sec = sp.gender === 'f' ? S : B;
    const before = placed.length;
    switch (primaryFlag(sp.flags)) {
      case F_ME:
        if (sp.flags & (F_MOD | F_SPEAKER)) putFront(sp, sec, FRONT_PREFS.me[sec]);
        else putRowPref(sp, sec, ME_SEAT[sec], sizes.me);
        break;
      case F_MOD:
        putFront(sp, sec, FRONT_PREFS.moderator[sec]);
        break;
      case F_SPEAKER:
        putFront(sp, sec, FRONT_PREFS.speaker[sec]);
        break;
      case F_BUDDY: {
        const prefs = BUDDY_SEATS[sec];
        if (sp.buddyIndex < prefs.length) putRowPref(sp, sec, prefs[sp.buddyIndex], sizes.buddy);
        else {
          const g = hashedInSection(sec, hash32(sp.id), sizes.buddy);
          if (g >= 0) putSeat(sp, sec, g, sizes.buddy);
        }
        break;
      }
      default: {
        const prefs = HAND_SEATS[sec];
        const h = hash32(sp.id);
        let g = -1;
        for (let k = 0; k < prefs.length && g < 0; k++) {
          const [row, deg] = prefs[(h + k) % prefs.length];
          const near = nearestInRow(rowBase[sec] + row, deg, sizes.hand, false);
          if (near >= 0 && seatFits(near, sizes.hand)) g = near;
        }
        if (g < 0) g = hashedInSection(sec, h, sizes.hand);
        if (g >= 0) putSeat(sp, sec, g, sizes.hand);
      }
    }
    if (placed.length > before) seated[sec]++;
  }

  // Listener seats: not taken, and not under any special's icon.
  const free: [number, number] = [0, 0];
  const listener = sizes.listener;
  for (let g = 0; g < reserved.length; g++) {
    let b = reserved[g];
    if (!b) {
      const x = seatX[g];
      const y = seatY[g];
      for (const p of placed) {
        const need = (listener + p.size) / 2;
        const dx = x - p.x;
        const dy = y - p.y;
        if (dx * dx + dy * dy < need * need) {
          b = 1;
          break;
        }
      }
    }
    blocked[g] = b;
    if (!b) free[g < secEnd[B] ? B : S]++;
  }
  return { placed, seated, free };
}

// ─── Public API ──────────────────────────────────────────────────────────────

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Positions every icon of the «الحلقة» board. Pure and deterministic. */
export function computeHalaqaLayout(input: HalaqaInput): HalaqaLayout {
  const size = cleanSize(input.size);
  const counts = [cleanCount(input.brothers), cleanCount(input.sisters)] as const;
  const plan = makePlan(input, size, counts[B], counts[S]);
  const people = [Math.max(counts[B], plan.inSection[B]), Math.max(counts[S], plan.inSection[S])] as const;

  let geom = geomOf('regular');
  let run = attempt(geom, plan);
  const fitsTier = (a: Attempt) =>
    [B, S].every((sec) => a.seated[sec] === plan.inSection[sec] && people[sec] - plan.inSection[sec] <= a.free[sec]);
  if (!fitsTier(run)) {
    geom = geomOf('compact');
    run = attempt(geom, plan);
  }

  const scale = size / HALAQA_REFERENCE_SIZE;
  const cx = HALAQA_BOARD.cx * scale;
  const cy = HALAQA_BOARD.cy * scale;
  const { seatX, seatY, seatDeg, seatRing, blocked, secStart, secEnd } = geom;
  const sizes = geom.spec.sizes;
  const px = (v: number) => round2(v * scale);
  const slots: HalaqaSlot[] = [];

  const special = (sp: Special, x: number, y: number, deg: number, ring: number, iconSize: number): HalaqaSlot => {
    const also = alsoKinds(sp.flags);
    const slot: HalaqaSlot = {
      id: sp.id,
      x: round2(cx + x * scale),
      y: round2(cy + y * scale),
      angle: deg,
      gender: sp.gender,
      kind: primaryKind(sp.flags),
      ring,
      size: px(iconSize),
    };
    return also ? { ...slot, also } : slot;
  };

  if (plan.host && plan.host.gender === 'm') slots.push(special(plan.host, 0, 0, -90, -1, MEDALLION.box));
  for (const p of run.placed) slots.push(special(p.sp, p.x, p.y, p.deg, p.ring, p.size));

  const overflow = [0, 0];
  const listenerPx = px(sizes.listener);
  for (let sec = 0; sec < 2; sec++) {
    const listeners = people[sec] - plan.inSection[sec];
    const free = run.free[sec];
    const n = Math.min(listeners, free);
    const chip = listeners > free && free > 0;
    // Filled free seats: {floor(i·free/n)}, counted in seat order.
    let i = 0;
    let k = 0;
    let target = 0;
    for (let g = secStart[sec]; g < secEnd[sec] && i < n; g++) {
      if (blocked[g]) continue;
      if (k === target) {
        const last = chip && i === n - 1;
        const slot: HalaqaSlot = {
          x: round2(cx + seatX[g] * scale),
          y: round2(cy + seatY[g] * scale),
          angle: seatDeg[g],
          gender: GENDERS[sec],
          kind: last ? 'more' : 'listener',
          ring: seatRing[g],
          size: listenerPx,
        };
        slots.push(last ? { ...slot, more: listeners - free + 1 } : slot);
        i++;
        target = Math.floor((i * free) / n);
      }
      k++;
    }
    const unseatedSpecials = plan.inSection[sec] - run.seated[sec];
    overflow[sec] = (chip ? listeners - free + 1 : Math.max(0, listeners - free)) + unseatedSpecials;
  }

  const height = HALAQA_BOARD.height * scale;
  return {
    key: plan.key,
    size,
    width: size,
    height,
    cx,
    cy,
    scale,
    tier: geom.tier,
    iconSize: listenerPx,
    sizes: {
      listener: listenerPx,
      me: px(sizes.me),
      buddy: px(sizes.buddy),
      hand: px(sizes.hand),
      front: px(sizes.front),
    },
    medallion: {
      outer: MEDALLION.outer * scale,
      inner: MEDALLION.inner * scale,
      core: MEDALLION.core * scale,
      box: MEDALLION.box * scale,
      rotation: MEDALLION.rotation,
    },
    frontRadius: R_FRONT * scale,
    rings: geom.rows.map((r, index) => ({
      index,
      section: SECTIONS[r.section],
      row: r.row,
      radius: r.r * scale,
      inner: (r.r - r.pitch / 2) * scale,
      outer: (r.r + r.pitch / 2) * scale,
      seats: r.count,
    })),
    hijab: {
      radius: R_HIJAB * scale,
      width: HIJAB_STROKE * scale,
      inner: (R_HIJAB - HIJAB_STROKE / 2) * scale,
      outer: (R_HIJAB + HIJAB_STROKE / 2) * scale,
    },
    labelRadius: { brothers: R_LABEL.brothers * scale, sisters: R_LABEL.sisters * scale },
    outerRadius: R_OUTER * scale,
    rippleRadius: R_RIPPLE * scale,
    slots,
    capacity: halaqaCapacity(geom.tier),
    overflow: { brothers: overflow[B], sisters: overflow[S] },
  };
}
