/**
 * «الحلقة» — the live room board (PLAN_LIVE_V23 §1.1 item 2, §7.4).
 *
 * The sheikh in the centre (8-point star medallion), brothers in rings around
 * him, the circular hijab (mashrabiya lattice), sisters outside it. A port of
 * the approved prototype's `DD.halaqa`; ALL seat geometry comes from
 * `src/lib/halaqaLayout.ts` (`computeHalaqaLayout` / `halaqaLayoutKey`).
 *
 * Rendering (§7.4 performance):
 *  - ONE <Svg> for the whole board: rug bands, floor, glow, front arc, lattice
 *    ring, star medallion, and every listener as a `<Use href="#pm|#pf">` of a
 *    16-unit <Symbol>. It lives in `HalaqaBoard`, memoized by the layout KEY
 *    (counts + specials) — a speaker change never re-renders it.
 *  - Overlays (a few RN views: «أنت», speakers, moderators, hands, the tooltip)
 *    and the ripples are the only parts that follow the active speaker.
 *  - Ripples: 3 Reanimated rings (`transform: scale`), off under Reduce Motion
 *    and while listening is paused.
 *
 * The board is drawn in the prototype's design units (viewBox −195 −205 390 410)
 * so the decorations keep the prototype's numbers; overlays use the layout's
 * board px. Forced RTL keeps `left`/`top` physical in this app
 * (`swapLeftAndRightInRTL(false)`, app/_layout.tsx), matching the layout's x.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, View, type GestureResponderEvent } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Path,
  Pattern,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Symbol as SvgSymbol,
  Use,
} from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import {
  HALAQA_BOARD,
  computeHalaqaLayout,
  halaqaLayoutKey,
  type HalaqaInput,
  type HalaqaLayout,
  type HalaqaPerson,
  type HalaqaSlot,
} from '@/lib/halaqaLayout';
import { BrotherShapes } from './BrotherIcon';
import { NiqabShapes } from './NiqabIcon';
import { HandGlyph, LiveAvatar } from './LiveAvatar';
import type { LiveCounts, LivePerson } from './liveTypes';
import { LIVE, roleKind, sexOf, speakVerb, type Sex } from './liveUi';

export type HalaqaMode = 'live' | 'skeleton' | 'empty';

// ─── Store → layout input ────────────────────────────────────────────────────

/**
 * Specials straight from the room: the host, «أنت», moderators and speakers in
 * arrival order (the people record keeps insertion order), raised hands.
 * Counts are the section totals, host excluded (the layout's convention); the
 * store's counts win when larger (people may still be arriving).
 */
export function buildHalaqaInput(
  people: Readonly<Record<string, LivePerson>>,
  counts: LiveCounts,
  size: number,
  mode: HalaqaMode,
): HalaqaInput {
  if (mode !== 'live') return { size, brothers: 0, sisters: 0 };
  let host: HalaqaPerson | null = null;
  let me: HalaqaPerson | null = null;
  const moderators: HalaqaPerson[] = [];
  const speakers: HalaqaPerson[] = [];
  const hands: HalaqaPerson[] = [];
  let brothers = 0;
  let sisters = 0;
  for (const [id, p] of Object.entries(people)) {
    const hp: HalaqaPerson = { id, gender: sexOf(p.gender) };
    const kind = roleKind(p.role);
    if (kind === 'host' && !host) {
      host = hp;
      continue;
    }
    if (hp.gender === 'f') sisters++;
    else brothers++;
    if (p.isMe) me = hp;
    if (kind === 'moderator') moderators.push(hp);
    else if (kind === 'speaker') speakers.push(hp);
    if (p.hand) hands.push(hp);
  }
  return {
    size,
    brothers: Math.max(brothers, counts?.brothers ?? 0),
    sisters: Math.max(sisters, counts?.sisters ?? 0),
    host,
    me,
    moderators,
    speakers,
    hands,
  };
}

/**
 * Who sits in each listener seat, for the tap tooltip: the layout's listener
 * seats are anonymous, so the i-th listener seat of a section gets the i-th
 * non-special person of that gender (arrival order).
 */
function seatOwners(layout: HalaqaLayout, people: Readonly<Record<string, LivePerson>>): (string | null)[] {
  const special = new Set<string>();
  for (const s of layout.slots) if (s.id) special.add(s.id);
  const queue: Record<Sex, string[]> = { m: [], f: [] };
  for (const [id, p] of Object.entries(people)) {
    if (special.has(id) || roleKind(p.role) === 'host') continue;
    queue[sexOf(p.gender)].push(id);
  }
  const next: Record<Sex, number> = { m: 0, f: 0 };
  return layout.slots.map((s) =>
    s.kind === 'listener' ? (queue[s.gender][next[s.gender]++] ?? null) : (s.id ?? null),
  );
}

// ─── The static board (memoized by the layout key) ───────────────────────────

const HALF_W = HALAQA_BOARD.width / 2;
const HALF_H = HALAQA_BOARD.height / 2;
const VIEWBOX = `${-HALF_W} ${-HALF_H} ${HALAQA_BOARD.width} ${HALAQA_BOARD.height}`;

/** The prototype's `DD.starPts`: 16 points, alternating R and R·0.7654. */
export function starPoints(R: number, rot = 22.5): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const rr = i % 2 === 0 ? R : R * 0.7654;
    const a = ((rot + i * 22.5) * Math.PI) / 180;
    pts.push(`${(rr * Math.cos(a)).toFixed(1)},${(rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** A ring (annulus) as one even-odd path — filled with the lattice pattern. */
function annulus(outer: number, inner: number): string {
  const ring = (r: number, sweep: 0 | 1) =>
    `M ${r} 0 A ${r} ${r} 0 1 ${sweep} ${-r} 0 A ${r} ${r} 0 1 ${sweep} ${r} 0 Z`;
  return `${ring(outer, 0)} ${ring(inner, 1)}`;
}

type BoardProps = {
  layout: HalaqaLayout;
  mode: HalaqaMode;
  hostOff: boolean;
  sheikhInitial: string;
  brothers: number;
  sisters: number;
  onMore: () => void;
  onBoardPress: (x: number, y: number) => void;
};

const HalaqaBoard = memo(function HalaqaBoard({
  layout,
  mode,
  hostOff,
  sheikhInitial,
  brothers,
  sisters,
  onMore,
  onBoardPress,
}: BoardProps) {
  const k = layout.scale;
  const du = (px: number) => px / k; // board px → design units
  const brotherRings = layout.rings.filter((r) => r.section === 'brothers');
  const sisterRings = layout.rings.filter((r) => r.section === 'sisters');
  const hijabIn = du(layout.hijab.inner);
  const hijabOut = du(layout.hijab.outer);
  const floor = hijabIn - 0.5;
  const med = layout.medallion;
  const starOn = !hostOff && mode === 'live';
  const live = mode === 'live';

  const listeners = live ? layout.slots.filter((s) => s.kind === 'listener') : [];

  const labelFont = Math.max(9, 10.5 * Math.min(1.1, k));
  const labelLine = Math.round(labelFont * 1.5);
  const label = (text: string, radius: number, color: string) => (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: layout.cy - radius - labelLine / 2,
        alignItems: 'center',
      }}
    >
      <Txt size={labelFont} weight="semibold" color={color} align="center" style={{ lineHeight: labelLine }}>
        {text}
      </Txt>
    </View>
  );

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height }}>
      <Svg width={layout.width} height={layout.height} viewBox={VIEWBOX} accessible={false}>
        <Defs>
          <RadialGradient id="hq-glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.accentBrass} stopOpacity={0.3} />
            <Stop offset="0.5" stopColor={colors.accentBrass} stopOpacity={0.07} />
            <Stop offset="1" stopColor={colors.accentBrass} stopOpacity={0} />
          </RadialGradient>
          <Pattern
            id="hq-lattice"
            width={6.5}
            height={6.5}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <Rect width={6.5} height={6.5} fill={LIVE.latticeFill} />
            <Path d="M0 0H6.5M0 0V6.5" stroke={LIVE.latticeLine} strokeWidth={1.3} />
          </Pattern>
          <SvgSymbol id="pm" viewBox="0 0 16 16">
            <BrotherShapes color={colors.primaryTeal600} />
          </SvgSymbol>
          <SvgSymbol id="pf" viewBox="0 0 16 16">
            <NiqabShapes color={colors.primaryTealDeep} eyeBand={colors.bgSand} />
          </SvgSymbol>
        </Defs>

        {/* Outer disc, the sisters' rug bands, the brothers' floor + bands. */}
        <Circle r={du(layout.outerRadius)} fill={colors.accentBrass} fillOpacity={0.08} />
        {sisterRings.map((r) => (
          <Circle
            key={`s${r.index}`}
            r={du(r.radius)}
            fill="none"
            stroke={colors.accentBrassMuted}
            strokeOpacity={0.08}
            strokeWidth={15}
          />
        ))}
        <Circle r={floor} fill={LIVE.floor} />
        {brotherRings.map((r) => (
          <Circle
            key={`b${r.index}`}
            r={du(r.radius)}
            fill="none"
            stroke={colors.primaryTeal}
            strokeOpacity={0.04}
            strokeWidth={15}
          />
        ))}
        <Circle r={floor} fill="url(#hq-glow)" />
        <Circle
          r={du(layout.frontRadius)}
          fill="none"
          stroke={colors.accentBrassMuted}
          strokeOpacity={0.4}
          strokeDasharray="1.5 4"
        />
        {!live
          ? layout.rings.map((r) => (
              <Circle
                key={`g${r.index}`}
                r={du(r.radius)}
                fill="none"
                stroke={colors.accentBrassMuted}
                strokeOpacity={0.3}
                strokeDasharray="1.5 5"
              />
            ))
          : null}

        {/* The hijab: mashrabiya lattice ring between thin brass borders. */}
        <Path d={annulus(hijabOut, hijabIn)} fill="url(#hq-lattice)" fillRule="evenodd" />
        <Circle r={hijabIn} fill="none" stroke={LIVE.latticeLine} strokeWidth={1.1} />
        <Circle r={hijabOut} fill="none" stroke={LIVE.latticeLine} strokeWidth={1.1} />

        {/* Listeners — one <Use> per seat. */}
        {listeners.map((s, i) => {
          const size = du(s.size);
          const opacity =
            s.gender === 'm' ? 0.5 + ((i * 37) % 9) * 0.028 : 0.68 + ((i * 29) % 7) * 0.035;
          return (
            <Use
              key={i}
              href={s.gender === 'f' ? '#pf' : '#pm'}
              x={du(s.x - layout.cx) - size / 2}
              y={du(s.y - layout.cy) - size / 2}
              width={size}
              height={size}
              opacity={opacity}
            />
          );
        })}

        {/* The sheikh: 8-point star medallion (dashed while the host is away). */}
        <G>
          <Polygon
            points={starPoints(du(med.outer), med.rotation)}
            fill={starOn ? colors.primaryTeal : 'rgba(243,236,221,0.6)'}
            stroke={starOn ? colors.accentBrass : colors.accentBrassMuted}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeDasharray={starOn ? undefined : '3 4'}
          />
          {starOn ? (
            <Polygon
              points={starPoints(du(med.inner), med.rotation)}
              fill="none"
              stroke={colors.accentBrass}
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          ) : null}
          <Circle
            r={du(med.core)}
            fill={starOn ? colors.primaryTealDeep : 'none'}
            stroke={starOn ? colors.accentBrass : colors.accentBrassMuted}
            strokeOpacity={starOn ? 0.35 : 1}
            strokeDasharray={starOn ? undefined : '2 4'}
          />
        </G>
      </Svg>

      {/* Zone labels — straight RN text (Arabic shaping on an SVG textPath is
          unreliable), at the prototype's label radii in each top gap. */}
      {label(
        live ? `الإخوة · ${arNum(brothers)}` : 'الإخوة',
        layout.labelRadius.brothers,
        colors.primaryTeal600,
      )}
      {label(
        live ? `الأخوات · ${arNum(sisters)}` : 'الأخوات',
        layout.labelRadius.sisters,
        LIVE.labelSisters,
      )}

      {starOn ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: layout.cx - med.core,
            top: layout.cy - med.core,
            width: med.core * 2,
            height: med.core * 2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt weight="display" size={28 * k} color={colors.accentBrass} align="center" centerGlyph>
            {sheikhInitial}
          </Txt>
        </View>
      ) : null}

      {/* One touch layer for every listener seat (hit-tested), under the chips. */}
      {live ? (
        <Pressable
          accessible={false}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          onPress={(e: GestureResponderEvent) =>
            onBoardPress(e.nativeEvent.locationX, e.nativeEvent.locationY)
          }
        />
      ) : null}

      {/* «+N» capacity chips (§7.4) → PeopleSheet. */}
      {live
        ? layout.slots
            .filter((s) => s.kind === 'more')
            .map((s) => (
              <View
                key={`more-${s.gender}`}
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  left: s.x - 30,
                  top: s.y - 9,
                  width: 60,
                  alignItems: 'center',
                }}
              >
                <Pressable
                  onPress={onMore}
                  accessibilityRole="button"
                  accessibilityLabel={`+${arNum(s.more ?? 0)} · من في الحلقة`}
                  hitSlop={6}
                  style={{
                    height: 18,
                    minWidth: 28,
                    paddingHorizontal: 6,
                    borderRadius: 9,
                    backgroundColor: colors.surfaceCard,
                    borderWidth: 1,
                    borderColor: colors.borderSand2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Txt size={10} weight="semibold" color={colors.textSlate} align="center" tabular>
                    {`+${arNum(s.more ?? 0)}`}
                  </Txt>
                </Pressable>
              </View>
            ))
        : null}
    </View>
  );
});

// ─── Ripples ─────────────────────────────────────────────────────────────────

const RIPPLE_MS = 4800;
const RIPPLE_DELAYS = [0, 1600, 3200];

function Ripple({ x, y, r, delay }: { x: number; y: number; r: number; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: RIPPLE_MS, easing: Easing.bezier(0.22, 0.61, 0.36, 1) }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(p);
  }, [delay, p]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.8 * (1 - p.value),
    transform: [{ scale: 0.18 + 0.82 * p.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          borderWidth: 1.3,
          borderColor: colors.accentBrassMuted,
        },
        style,
      ]}
    />
  );
}

/** `AccessibilityInfo.isReduceMotionEnabled` + live updates. */
export function useReduceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setOn(!!v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => {
      if (alive) setOn(!!v);
    });
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}

// ─── The public component ────────────────────────────────────────────────────

type Tip = { x: number; y: number; title: string; sub: string | null };

/** Tooltip copy for a person: name (or «طالبة») + a quiet role line. */
export function describePerson(p: LivePerson, name: string): { title: string; sub: string } {
  const f = sexOf(p.gender) === 'f';
  const kind = roleKind(p.role);
  let sub =
    kind === 'host'
      ? 'الشيخ'
      : kind === 'moderator'
        ? f ? 'مشرفة' : 'مشرف'
        : kind === 'speaker'
          ? f ? 'متحدثة' : 'متحدث'
          : p.hand
            ? f ? 'تطلب الكلمة' : 'يطلب الكلمة'
            : f ? 'مستمعة' : 'مستمع';
  if (p.hidden) sub += ' · بدون اسم';
  return { title: name, sub };
}

export type HalaqaProps = {
  /** Board width in px (height = width · 410/390). */
  size: number;
  people: Readonly<Record<string, LivePerson>>;
  counts: LiveCounts;
  mode: HalaqaMode;
  /** Host away / dropped: the star turns dashed. */
  hostOff: boolean;
  /** `activeSpeakers[0]` — the ripple centre. */
  speakerId: string | null;
  paused: boolean;
  sheikhName: string;
  /** Display name for a person (staff get real names, others «طالبة» for hidden sisters). */
  nameOf: (identity: string, p: LivePerson) => string;
  onMorePress: () => void;
  /** Moderators (P4): a tapped attendee opens their Person/Request sheet instead of the tooltip. */
  onPersonPress?: (identity: string) => void;
  dim?: boolean;
};

export function Halaqa({
  size,
  people,
  counts,
  mode,
  hostOff,
  speakerId,
  paused,
  sheikhName,
  nameOf,
  onMorePress,
  onPersonPress,
  dim = false,
}: HalaqaProps) {
  const input = useMemo(() => buildHalaqaInput(people, counts, size, mode), [people, counts, size, mode]);
  const key = halaqaLayoutKey(input);
  const inputRef = useRef(input);
  inputRef.current = input;
  // Recomputed only when the key changes (counts / specials / size), §7.4.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeHalaqaLayout(inputRef.current), [key]);

  const owners = useMemo(() => seatOwners(layout, people), [layout, people]);
  const reduceMotion = useReduceMotion();
  const [tip, setTip] = useState<Tip | null>(null);

  // Stable callbacks for the memoized board, reading the latest values by ref.
  const latest = useRef({ layout, owners, people, nameOf, onMorePress, onPersonPress });
  latest.current = { layout, owners, people, nameOf, onMorePress, onPersonPress };
  const onMore = useCallback(() => latest.current.onMorePress(), []);
  const onBoardPress = useCallback((x: number, y: number) => {
    const { layout: L, owners: O, people: P, nameOf: N, onPersonPress: onPerson } = latest.current;
    let best = -1;
    let bestD = Infinity;
    L.slots.forEach((s, i) => {
      if (s.kind !== 'listener') return;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const slot = best >= 0 ? L.slots[best] : null;
    if (!slot || Math.sqrt(bestD) > Math.max(slot.size * 0.8, 12)) {
      setTip(null);
      return;
    }
    const owner = O[best];
    const person = owner ? P[owner] : undefined;
    const top = slot.y - slot.size / 2;
    if (person && owner && onPerson && !person.isMe) {
      setTip(null);
      onPerson(owner);
    } else if (person && owner) {
      const d = describePerson(person, N(owner, person));
      setTip({ x: slot.x, y: top, title: d.title, sub: d.sub });
    } else {
      setTip({ x: slot.x, y: top, title: slot.gender === 'f' ? 'مستمعة' : 'مستمع', sub: null });
    }
  }, []);

  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(null), 3500);
    return () => clearTimeout(t);
  }, [tip]);

  const live = mode === 'live';
  const sheikhInitial =
    Array.from(sheikhName.replace(/^(الشيخ|د\.|الدكتور)\s+/, '').trim())[0] ?? 'ع';

  // Ripple centre: the speaker's seat, or the medallion for the host.
  let center: { x: number; y: number } | null = null;
  if (live && speakerId && !paused) {
    const slot = layout.slots.find((s) => s.id === speakerId);
    if (slot) center = { x: slot.x, y: slot.y };
    else if (people[speakerId] && roleKind(people[speakerId].role) === 'host') {
      center = { x: layout.cx, y: layout.cy };
    }
  }

  const specials = live ? layout.slots.filter((s) => s.id && !(s.kind === 'host' && s.ring === -1)) : [];
  const hostSlot = layout.slots.find((s) => s.kind === 'host' && s.ring === -1);
  const hostId = hostSlot?.id ?? null;

  const showTipFor = (slot: HalaqaSlot, id: string) => {
    const p = people[id];
    if (!p) return;
    const d = describePerson(p, nameOf(id, p));
    setTip({ x: slot.x, y: slot.y - slot.size / 2, title: d.title, sub: d.sub });
  };

  return (
    <View
      style={{ width: layout.width, height: layout.height, opacity: dim ? 0.42 : 1 }}
      accessibilityLabel="الحلقة"
    >
      <HalaqaBoard
        layout={layout}
        mode={mode}
        hostOff={hostOff}
        sheikhInitial={sheikhInitial}
        brothers={input.brothers}
        sisters={input.sisters}
        onMore={onMore}
        onBoardPress={onBoardPress}
      />

      {center && !reduceMotion
        ? RIPPLE_DELAYS.map((d) => (
            <Ripple
              key={`${center!.x},${center!.y},${d}`}
              x={center!.x}
              y={center!.y}
              r={layout.rippleRadius}
              delay={d}
            />
          ))
        : null}

      {/* The medallion: tap → the sheikh's name; «انقطع مؤقتاً» while away. */}
      {live ? (
        <Pressable
          onPress={() => {
            const p = hostId ? people[hostId] : undefined;
            setTip({
              x: layout.cx,
              y: layout.cy - layout.medallion.box / 2 + 6,
              title: sheikhName || (p && hostId ? nameOf(hostId, p) : ''),
              sub: 'الشيخ',
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={sheikhName}
          style={{
            position: 'absolute',
            left: layout.cx - layout.medallion.core * 1.4,
            top: layout.cy - layout.medallion.core * 1.4,
            width: layout.medallion.core * 2.8,
            height: layout.medallion.core * 2.8,
            borderRadius: layout.medallion.core * 1.4,
          }}
        />
      ) : null}
      {live && hostOff ? (
        <SeatLabel
          x={layout.cx}
          y={layout.cy + layout.medallion.box / 2 + 3}
          text="انقطع مؤقتاً"
          tone="off"
        />
      ) : null}

      {specials.map((slot) => {
        const id = slot.id!;
        const p = people[id];
        if (!p) return null;
        const g = slot.gender;
        const also = slot.also ?? [];
        const isMe = slot.kind === 'me';
        const speaking = id === speakerId && !paused;
        const label = isMe
          ? speaking
            ? `أنت · ${speakVerb(g)}`
            : 'أنت'
          : speaking
            ? `${nameOf(id, p)} · ${speakVerb(g)}`
            : null;
        return (
          <View key={id} pointerEvents="box-none">
            <Pressable
              onPress={isMe ? undefined : onPersonPress ? () => onPersonPress(id) : () => showTipFor(slot, id)}
              disabled={isMe}
              accessibilityRole={isMe ? undefined : 'button'}
              accessibilityLabel={isMe ? 'أنت' : nameOf(id, p)}
              style={{
                position: 'absolute',
                left: slot.x - slot.size / 2,
                top: slot.y - slot.size / 2,
                width: slot.size,
                height: slot.size,
              }}
            >
              {slot.kind === 'hand' ? (
                <View
                  style={{
                    width: slot.size,
                    height: slot.size,
                    borderRadius: slot.size / 2,
                    backgroundColor: colors.accentBrass,
                    borderWidth: 2,
                    borderColor: 'rgba(201,164,99,0.35)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <HandGlyph size={slot.size * 0.55} color={colors.primaryTealDeep} />
                </View>
              ) : (
                <LiveAvatar
                  gender={g}
                  size={slot.size}
                  me={isMe}
                  moderator={slot.kind === 'moderator' || also.includes('moderator')}
                />
              )}
            </Pressable>
            {label ? (
              <SeatLabel
                x={slot.x}
                y={slot.y + slot.size / 2 + 3}
                text={label}
                tone={isMe ? 'me' : 'on'}
              />
            ) : null}
          </View>
        );
      })}

      {tip ? <Tooltip tip={tip} boardWidth={layout.width} boardHeight={layout.height} /> : null}
    </View>
  );
}

// ─── Small overlays ──────────────────────────────────────────────────────────

/** The prototype's `.nm` pill under an icon. */
function SeatLabel({
  x,
  y,
  text,
  tone,
}: {
  x: number;
  y: number;
  text: string;
  tone: 'me' | 'on' | 'off';
}) {
  const bg = tone === 'me' ? colors.accentBrass : 'rgba(251,247,237,0.95)';
  const border = tone === 'me' ? colors.accentBrass : tone === 'on' ? 'rgba(176,137,79,0.5)' : colors.borderSand;
  const color =
    tone === 'me' ? colors.primaryTealDeep : tone === 'on' ? colors.accentBrassMuted : colors.stateDanger;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: x - 70, top: y, width: 140, alignItems: 'center' }}
    >
      <View
        style={{
          paddingHorizontal: 6,
          borderRadius: 999,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          maxWidth: 140,
        }}
      >
        <Txt size={9.5} weight="semibold" color={color} align="center" numberOfLines={1}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

const TIP_MAX_W = 220;

/** Small teal bubble above the tapped icon (the prototype's `.pop`). */
function Tooltip({ tip, boardWidth, boardHeight }: { tip: Tip; boardWidth: number; boardHeight: number }) {
  // Measured bubble width → centred on the icon, clamped inside the board, with
  // the arrow still pointing at the icon. Hidden for the one measuring frame.
  const [w, setW] = useState(0);
  const bw = w || TIP_MAX_W;
  const left = Math.min(Math.max(4, tip.x - bw / 2), Math.max(4, boardWidth - bw - 4));
  const arrowLeft = Math.min(bw - 14, Math.max(4, tip.x - left - 5));
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
      style={{
        position: 'absolute',
        left,
        bottom: boardHeight - tip.y + 8,
        opacity: w ? 1 : 0,
      }}
    >
      <View
        style={{
          backgroundColor: colors.primaryTealDeep,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 7,
          maxWidth: TIP_MAX_W,
        }}
      >
        <Txt size={12.5} weight="semibold" color={colors.onTealPrimary} align="center" numberOfLines={1}>
          {tip.title}
        </Txt>
        {tip.sub ? (
          <Txt size={11} color={colors.onTealSecondary} align="center" numberOfLines={1}>
            {tip.sub}
          </Txt>
        ) : null}
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: -5,
          left: arrowLeft,
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: colors.primaryTealDeep,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}
