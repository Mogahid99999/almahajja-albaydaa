/**
 * src/lib/halaqaLayout.ts — «الحلقة» board geometry, ported from the approved
 * prototype (PLAN_LIVE_V23 §1.1 item 2, §7.4). Pins the per-tier capacities, the
 * «+N» chip, the hijab gender separation, non-overlap, the prototype's special
 * seats, stable seats for specials, the angle convention and the memo key.
 */
import {
  computeHalaqaLayout,
  HALAQA_BOARD,
  halaqaCapacity,
  halaqaLayoutKey,
  type HalaqaInput,
  type HalaqaLayout,
  type HalaqaPerson,
  type HalaqaSlot,
} from '../halaqaLayout';

/** The prototype board width: sizes and radii read in its design units. */
const SIZE = HALAQA_BOARD.width;

const m = (id: string): HalaqaPerson => ({ id, gender: 'm' });
const f = (id: string): HalaqaPerson => ({ id, gender: 'f' });

const SPECIALS = {
  host: m('sheikh'),
  me: m('me-01'),
  moderators: [m('mod-1'), f('mod-f')],
  speakers: [m('spk-a'), f('spk-b'), m('spk-c'), f('spk-d'), f('spk-e')],
  buddies: [m('bud-1'), m('bud-2')],
  hands: [m('hand-1'), f('hand-2'), f('hand-3'), m('hand-4')],
} satisfies Partial<HalaqaInput>;
const SPECIAL_IDS = [
  'sheikh', 'me-01', 'mod-1', 'mod-f', 'spk-a', 'spk-b', 'spk-c', 'spk-d', 'spk-e',
  'bud-1', 'bud-2', 'hand-1', 'hand-2', 'hand-3', 'hand-4',
];

const layout = (brothers: number, sisters: number, extra: Partial<HalaqaInput> = {}) =>
  computeHalaqaLayout({ size: SIZE, brothers, sisters, ...extra });

const dist = (l: HalaqaLayout, s: HalaqaSlot) => Math.hypot(s.x - l.cx, s.y - l.cy);
const isSpecial = (s: HalaqaSlot) => s.kind !== 'listener' && s.kind !== 'more';
/** Everyone drawn in a section (host excluded; the «+N» chip is not a person). */
const drawn = (l: HalaqaLayout, g: 'm' | 'f') =>
  l.slots.filter((s) => s.gender === g && s.kind !== 'host' && s.kind !== 'more');

function seatOf(l: HalaqaLayout, id: string) {
  const s = l.slots.find((x) => x.id === id);
  if (!s) throw new Error(`no seat for ${id}`);
  return { x: s.x, y: s.y, ring: s.ring, angle: s.angle };
}

/** Angular distance, and half the seat spacing of a row (the "nearest seat" tolerance). */
const angDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const halfSpacing = (l: HalaqaLayout, ring: number) => 360 / Math.floor((2 * Math.PI * l.rings[ring].radius) / (l.tier === 'regular' ? 19 : 13)) / 2;
const ringOf = (l: HalaqaLayout, section: 'brothers' | 'sisters', row: number) =>
  l.rings.find((r) => r.section === section && r.row === row)!.index;

describe('capacity (§7.4)', () => {
  test('the prototype rows hold 137 + 92 = 229 at 15 px and 201 + 134 = 335 at 12 px', () => {
    expect(halaqaCapacity('regular')).toEqual({ brothers: 137, sisters: 92 });
    expect(halaqaCapacity('compact')).toEqual({ brothers: 201, sisters: 134 });
    const l = layout(1, 1);
    expect(l.rings.map((r) => [r.section, r.radius])).toEqual([
      ['brothers', 90], ['brothers', 107], ['brothers', 124], ['brothers', 141],
      ['sisters', 171], ['sisters', 186],
    ]);
    expect(l.hijab).toEqual({ radius: 156, width: 11, inner: 150.5, outer: 161.5 });
    expect(l.frontRadius).toBe(62);
  });

  test('a full 15 px board (229) seats everyone', () => {
    const l = layout(137, 92);
    expect(l.tier).toBe('regular');
    expect(l.iconSize).toBe(15);
    expect(l.overflow).toEqual({ brothers: 0, sisters: 0 });
    expect(l.slots).toHaveLength(229);
  });

  test('one more shrinks to 12 px — also when only one section outgrows its rows', () => {
    expect(layout(137, 93)).toMatchObject({ tier: 'compact', iconSize: 12 });
    expect(layout(138, 0).tier).toBe('compact');
    expect(layout(137, 0).tier).toBe('regular');
  });

  test('a full 12 px board (335) seats everyone', () => {
    const l = layout(201, 134);
    expect(l.tier).toBe('compact');
    expect(l.overflow).toEqual({ brothers: 0, sisters: 0 });
    expect(l.slots).toHaveLength(335);
  });

  test('beyond that the last filled seat becomes «+N» with N = count − cap + 1', () => {
    const l = layout(400, 300);
    expect(l.overflow).toEqual({ brothers: 400 - 201 + 1, sisters: 300 - 134 + 1 });
    for (const [g, section] of [['m', 'brothers'], ['f', 'sisters']] as const) {
      const chips = l.slots.filter((s) => s.kind === 'more' && s.gender === g);
      expect(chips).toHaveLength(1);
      expect(chips[0].more).toBe(l.overflow[section]);
      // The chip takes the section's last seat: its outer row, the highest angle.
      const lastRow = l.rings.filter((r) => r.section === section).at(-1)!.index;
      const rowAngles = l.slots.filter((s) => s.ring === lastRow).map((s) => s.angle);
      expect(chips[0]).toMatchObject({ ring: lastRow, angle: Math.max(...rowAngles) });
    }
  });

  test('with specials, icons + «+N» still add up to every section’s count', () => {
    const l = layout(400, 300, SPECIALS);
    expect(drawn(l, 'm').length + l.overflow.brothers).toBe(400);
    expect(drawn(l, 'f').length + l.overflow.sisters).toBe(300);
    for (const id of SPECIAL_IDS) expect(() => seatOf(l, id)).not.toThrow();
  });

  test('counts include the specials but not the host', () => {
    const l = layout(5, 0, { host: m('sheikh'), me: m('me-01'), speakers: [m('s1'), m('s2')] });
    expect(drawn(l, 'm')).toHaveLength(5);
    expect(l.slots.filter((s) => s.kind === 'listener')).toHaveLength(2);
  });

  test('scales the 390×410 board to the given width like an SVG viewBox', () => {
    const l = computeHalaqaLayout({ size: SIZE * 2, brothers: 10, sisters: 10 });
    expect(l).toMatchObject({ width: 780, height: 820, cx: 390, cy: 410, iconSize: 30, frontRadius: 124 });
    expect(l.hijab.outer).toBe(323);
    expect(computeHalaqaLayout({ size: SIZE * 2, brothers: 300, sisters: 0 }).iconSize).toBe(24);
  });

  test('garbage counts are treated as an empty section', () => {
    const l = layout(Number.NaN, -3);
    expect(l.slots).toHaveLength(0);
    expect(l.overflow).toEqual({ brothers: 0, sisters: 0 });
  });
});

describe('the hijab separates brothers and sisters', () => {
  const boards: [string, HalaqaLayout][] = [
    ['15 px with specials', layout(60, 40, SPECIALS)],
    ['full 15 px', layout(137, 92)],
    ['full 12 px with specials', layout(201, 134, SPECIALS)],
    ['overflowing, sister «أنت»', layout(500, 500, { ...SPECIALS, me: f('me-f') })],
  ];

  test.each(boards)('%s: listeners wholly on their side of the lattice', (_, l) => {
    const half = l.iconSize / 2;
    for (const s of l.slots.filter((x) => !isSpecial(x))) {
      if (s.gender === 'm') expect(dist(l, s) + half).toBeLessThan(l.hijab.inner);
      else expect(dist(l, s) - half).toBeGreaterThan(l.hijab.outer);
    }
  });

  test.each(boards)('%s: no icon, at its drawn size, reaches past the lattice', (_, l) => {
    for (const s of l.slots.filter(isSpecial)) {
      if (s.gender === 'm') {
        expect(dist(l, s)).toBeLessThan(l.hijab.inner);
        expect(dist(l, s) + s.size / 2).toBeLessThan(l.hijab.outer);
      } else {
        expect(dist(l, s)).toBeGreaterThan(l.hijab.outer);
        expect(dist(l, s) - s.size / 2).toBeGreaterThan(l.hijab.inner);
      }
    }
  });

  test('a sister hosting sits on the sisters’ front, never in the centre medallion', () => {
    const l = layout(40, 30, { host: f('host-f') });
    expect(l.slots.find((s) => s.kind === 'host')).toMatchObject({ ring: -2, angle: 90 });
    expect(dist(l, l.slots.find((s) => s.kind === 'host')!)).toBeGreaterThan(l.hijab.outer);
    expect(l.slots.some((s) => s.ring === -1)).toBe(false);
  });
});

describe('icons never overlap', () => {
  test.each([
    ['full 15 px with specials', layout(137, 92, SPECIALS)],
    ['full 12 px with specials', layout(201, 134, SPECIALS)],
    ['overflowing, sister «أنت» speaking', layout(900, 900, { ...SPECIALS, me: f('me-f'), speakers: [f('me-f'), ...SPECIALS.speakers] })],
  ])('%s', (_, l) => {
    const { slots } = l;
    const clashes: string[] = [];
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        // Listener seats: the prototype's two sister rows are exactly 15 apart, so
        // 15 px sisters touch (14.56 after its whole-unit rounding).
        const need = isSpecial(a) || isSpecial(b) ? (a.size + b.size) / 2 : 0.97 * l.iconSize;
        if (d < need) clashes.push(`${a.kind}:${a.id ?? a.angle} × ${b.kind}:${b.id ?? b.angle} = ${d.toFixed(2)}`);
      }
    }
    expect(clashes).toEqual([]);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(l.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(l.height);
      if (s.kind === 'listener') {
        expect(s.x - s.size / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + s.size / 2).toBeLessThanOrEqual(l.width);
      }
    }
  });
});

describe('the prototype’s special seats', () => {
  test('the sheikh is the medallion at the centre', () => {
    const l = layout(10, 10, { host: m('sheikh') });
    expect(l.slots[0]).toMatchObject({ id: 'sheikh', kind: 'host', ring: -1, x: l.cx, y: l.cy, size: 88 });
    expect(l.medallion).toEqual({ outer: 43, inner: 35, core: 25, box: 88, rotation: 22.5 });
  });

  test('«أنت»: brothers row 1 at −35°, sisters row 0 at −40° — a raised hand does not move it', () => {
    const b = layout(30, 30, { me: m('me-01') });
    const me = seatOf(b, 'me-01');
    expect(me.ring).toBe(ringOf(b, 'brothers', 1));
    expect(angDist(me.angle, -35)).toBeLessThanOrEqual(halfSpacing(b, me.ring));
    expect(b.slots.find((s) => s.id === 'me-01')!.size).toBe(24);

    const withHand = layout(30, 30, { me: m('me-01'), hands: [m('me-01')] });
    expect(withHand.slots.filter((s) => s.id === 'me-01')).toEqual([
      expect.objectContaining({ kind: 'me', x: me.x, y: me.y, also: ['hand'] }),
    ]);

    const s = layout(30, 30, { me: f('me-f') });
    const meF = seatOf(s, 'me-f');
    expect(meF.ring).toBe(ringOf(s, 'sisters', 0));
    expect(angDist(meF.angle, -40)).toBeLessThanOrEqual(halfSpacing(s, meF.ring));
  });

  test('front arc, first come first served: brothers on r 62, sisters in the bottom gap of r 171', () => {
    const l = layout(30, 30, {
      moderators: [m('mod'), f('mod-f')],
      speakers: [m('s1'), m('s2'), m('s3'), m('s4'), m('s5'), f('t1'), f('t2'), f('t3')],
    });
    const angle = (id: string) => seatOf(l, id).angle;
    expect(['mod', 's1', 's2', 's3', 's4', 's5'].map(angle)).toEqual([-45, 90, 45, 0, 180, 225]);
    expect(['t1', 't2', 't3', 'mod-f'].map(angle)).toEqual([108, 72, 128, 52]);
    for (const id of ['mod', 's1', 's5']) expect(dist(l, l.slots.find((s) => s.id === id)!)).toBeCloseTo(62, 0);
    for (const id of ['t1', 'mod-f']) expect(dist(l, l.slots.find((s) => s.id === id)!)).toBeCloseTo(171, 0);
    for (const s of l.slots.filter((x) => x.kind === 'speaker' || x.kind === 'moderator')) {
      expect(s).toMatchObject({ ring: -2, size: 28 });
    }
  });

  test('«أنت» speaking sits on the front at 135° (brothers) / 90° (sisters)', () => {
    const b = layout(20, 20, { me: m('me-01'), speakers: [m('s1'), m('me-01')] });
    expect(b.slots.find((s) => s.id === 'me-01')).toMatchObject({ kind: 'me', angle: 135, ring: -2, also: ['speaker'] });
    expect(seatOf(b, 's1').angle).toBe(90);
    const s = layout(20, 20, { me: f('me-f'), moderators: [f('me-f')] });
    expect(s.slots.find((x) => x.id === 'me-f')).toMatchObject({ kind: 'me', angle: 90, ring: -2, also: ['moderator'] });
  });

  test('buddies: brothers #1 row 0 @120°, #2 row 3 @−140°; sisters #1 row 0 @200°, #2 row 1 @−120°', () => {
    const cases = [
      [m('me-01'), [m('b1'), m('b2')], 'brothers', [[0, 120], [3, -140]]],
      [f('me-f'), [f('b1'), f('b2')], 'sisters', [[0, 200], [1, -120]]],
    ] as const;
    for (const [me, buddies, section, prefs] of cases) {
      const l = layout(30, 30, { me, buddies: [...buddies] });
      prefs.forEach(([row, deg], i) => {
        const seat = seatOf(l, buddies[i].id);
        expect(seat.ring).toBe(ringOf(l, section, row));
        expect(angDist(seat.angle, deg)).toBeLessThanOrEqual(halfSpacing(l, seat.ring));
      });
    }
  });

  test('a lone raised hand takes one of the prototype’s hand seats', () => {
    const prefs = {
      m: [[1, 205], [2, 22], [0, 160]],
      f: [[0, 150], [1, 250]],
    } as const;
    for (const g of ['m', 'f'] as const) {
      for (const id of ['h-1', 'h-2', 'h-3', 'h-4']) {
        const l = layout(30, 30, { hands: [{ id, gender: g }] });
        const seat = seatOf(l, id);
        const section = g === 'm' ? 'brothers' : 'sisters';
        const hit = prefs[g].some(
          ([row, deg]) => seat.ring === ringOf(l, section, row) && angDist(seat.angle, deg) <= halfSpacing(l, seat.ring),
        );
        expect(hit).toBe(true);
      }
    }
  });

  test('one person in several roles gets one slot and one primary kind', () => {
    const l = layout(20, 0, { host: m('sheikh'), me: m('sheikh'), buddies: [m('b1')], hands: [m('b1')] });
    expect(l.slots.filter((s) => s.id === 'sheikh')).toEqual([
      expect.objectContaining({ kind: 'host', ring: -1, also: ['me'] }),
    ]);
    expect(l.slots.filter((s) => s.id === 'b1')).toEqual([expect.objectContaining({ kind: 'buddy', also: ['hand'] })]);
  });
});

describe('deterministic, stable seats', () => {
  test('the same input gives the same board; the order of hands does not matter', () => {
    const a = layout(70, 40, SPECIALS);
    expect(layout(70, 40, SPECIALS)).toEqual(a);
    const h = SPECIALS.hands;
    expect(layout(70, 40, { ...SPECIALS, hands: [h[3], h[1], h[0], h[2], h[1]] })).toEqual(a);
  });

  test('specials keep their seats when listeners join or leave (same tier)', () => {
    const base = layout(40, 20, SPECIALS);
    for (const [b, s] of [[41, 20], [40, 21], [15, 16], [70, 45]] as const) {
      const other = layout(b, s, SPECIALS);
      expect(other.tier).toBe(base.tier);
      for (const id of SPECIAL_IDS) expect(seatOf(other, id)).toEqual(seatOf(base, id));
    }
  });

  test('a hand going up or down never moves «أنت», the front or a buddy', () => {
    const base = layout(60, 40, SPECIALS);
    const others = SPECIAL_IDS.filter((id) => !id.startsWith('hand'));
    for (const hands of [[...SPECIALS.hands, m('hand-9'), f('hand-8')], []]) {
      const l = layout(60, 40, { ...SPECIALS, hands });
      for (const id of others) expect(seatOf(l, id)).toEqual(seatOf(base, id));
    }
  });
});

describe('angle convention (the prototype’s, used as-is)', () => {
  test('x = r·cos(deg), y = r·sin(deg): −90° top, clockwise on screen', () => {
    const l = layout(137, 92, { speakers: [m('s1'), f('t1')] });
    for (const s of l.slots) {
      const a = (s.angle * Math.PI) / 180;
      const r = s.ring >= 0 ? l.rings[s.ring].radius : s.gender === 'm' ? l.frontRadius : l.rings[ringOf(l, 'sisters', 0)].radius;
      // Positions are whole design units (as in the prototype); `angle` is kept to 0.01°.
      expect(Math.abs(s.x - (l.cx + r * Math.cos(a)))).toBeLessThanOrEqual(0.52);
      expect(Math.abs(s.y - (l.cy + r * Math.sin(a)))).toBeLessThanOrEqual(0.52);
    }
  });

  test('every row starts just right of the top gap (the RTL start side) and runs clockwise', () => {
    const l = layout(137, 92);
    for (const ring of l.rings) {
      const seats = l.slots.filter((s) => s.ring === ring.index);
      const first = seats.reduce((a, b) => (b.angle < a.angle ? b : a));
      const last = seats.reduce((a, b) => (b.angle > a.angle ? b : a));
      expect(first.x).toBeGreaterThan(l.cx);
      expect(first.y).toBeLessThan(l.cy);
      expect(last.x).toBeLessThan(l.cx);
      expect(last.y).toBeLessThan(l.cy);
    }
  });

  test('listeners spread evenly over all rows, starting at the first seat', () => {
    const l = layout(4, 0); // seats floor(i·137/4) = 0, 34, 68, 102
    expect(l.slots.map((s) => s.ring)).toEqual([0, 1, 2, 3]);
    expect(l.slots[0].x).toBeGreaterThan(l.cx);
    expect(l.slots[0].y).toBeLessThan(l.cy);
  });
});

describe('layout key (§7.4 memoization)', () => {
  const input: HalaqaInput = { size: SIZE, brothers: 70, sisters: 40, ...SPECIALS };
  const key = halaqaLayoutKey(input);

  test('is the key of the computed layout', () => {
    expect(computeHalaqaLayout(input).key).toBe(key);
  });

  test('is unchanged by a no-op: rebuilt input, reordered hands, extra person fields', () => {
    expect(halaqaLayoutKey({ ...input })).toBe(key);
    expect(halaqaLayoutKey({ ...input, hands: [...SPECIALS.hands].reverse() })).toBe(key);
    const withMicState = { ...m('spk-a'), name: 'حسن', muted: true, speaking: true } as HalaqaPerson;
    expect(halaqaLayoutKey({ ...input, speakers: [withMicState, ...SPECIALS.speakers.slice(1)] })).toBe(key);
  });

  test('changes when a count or a special placement changes', () => {
    const changed: Partial<HalaqaInput>[] = [
      { brothers: 71 },
      { sisters: 39 },
      { size: SIZE + 1 },
      { hands: [...SPECIALS.hands, m('hand-9')] },
      { speakers: SPECIALS.speakers.slice(1) },
      { speakers: [...SPECIALS.speakers].reverse() }, // first come, first served
      { me: f('me-01') },
      { host: null },
      { moderators: [] },
      { buddies: [m('bud-2'), m('bud-1')] },
    ];
    for (const change of changed) expect(halaqaLayoutKey({ ...input, ...change })).not.toBe(key);
  });
});

test('a 335-seat board is computed in well under 1 ms', () => {
  const input: HalaqaInput = { size: SIZE, brothers: 201, sisters: 134, ...SPECIALS };
  for (let i = 0; i < 20; i++) computeHalaqaLayout(input); // warm up
  // Best of 5 batches: the full suite runs workers in parallel, and one batch
  // can be starved by a neighbour (the flaky full-run failure) — the fastest
  // batch is the layout's own cost.
  const runs = 100;
  let best = Infinity;
  for (let b = 0; b < 5; b++) {
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) computeHalaqaLayout(input);
    best = Math.min(best, (performance.now() - t0) / runs);
  }
  expect(best).toBeLessThan(1);
});
