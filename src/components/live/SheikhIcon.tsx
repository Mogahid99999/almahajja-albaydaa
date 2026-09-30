/**
 * The sheikh pictogram of «الحلقة» (owner, 2026-09-29: «نصف الحلقة يكون فيها
 * ايقونة شيخ بدل الرقم او الحرف»): a scholar with an ʿimāma, a rounded beard
 * and an open bisht, on the same 16-unit grid and in the same flat silhouette
 * style as BrotherIcon / NiqabIcon. It replaces the name's initial everywhere
 * the host is drawn (halaqa medallion, mini-bar, «في الحلقة», sheet headers).
 *
 * Two inks: the figure (`color`) and the thin fold lines of the turban and the
 * cloak opening (`band`, normally the surface it sits on).
 */
import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/theme';

/** The ʿimāma: a dome resting just above the brow. */
export const SHEIKH_TURBAN =
  'M3.9 4.6C3.9 2.2 5.7.7 8 .7s4.1 1.5 4.1 3.9c0 .35-.28.6-.62.6H4.52c-.34 0-.62-.25-.62-.6z';
/** Two folds of the turban cloth. */
export const SHEIKH_TURBAN_FOLDS = ['M4.7 3.5c1.9-.95 4.7-.95 6.6 0', 'M5.9 1.85c1.3-.4 2.9-.4 4.2 0'] as const;
/** The face running into a rounded beard. */
export const SHEIKH_FACE = 'M5.2 5.9h5.6v1.3c0 1.9-1.25 3.3-2.8 3.3S5.2 9.1 5.2 7.2z';
/** Shoulders in a bisht, with a notch under the beard. */
export const SHEIKH_BODY =
  'M1.8 15.5c0-3.1 2-5.2 4.4-5.9.5.9 1.1 1.5 1.8 1.5s1.3-.6 1.8-1.5c2.4.7 4.4 2.8 4.4 5.9z';
/** The bisht's opening. */
export const SHEIKH_CLOAK_LINE = 'M8 11.9v3.6';

/** The raw shapes (no <Svg>), for a `<Symbol viewBox="0 0 16 16">`. */
export function SheikhShapes({ color, band }: { color: string; band: string }) {
  return (
    <>
      <Path d={SHEIKH_TURBAN} fill={color} />
      {SHEIKH_TURBAN_FOLDS.map((d) => (
        <Path key={d} d={d} fill="none" stroke={band} strokeWidth={0.6} strokeLinecap="round" />
      ))}
      <Path d={SHEIKH_FACE} fill={color} />
      <Path d={SHEIKH_BODY} fill={color} />
      <Path d={SHEIKH_CLOAK_LINE} fill="none" stroke={band} strokeWidth={0.6} strokeLinecap="round" />
    </>
  );
}

/** What a screen reader hears for the sheikh's tile: his name, else «الشيخ». */
export function sheikhIconLabel(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n || 'الشيخ';
}

export const SheikhIcon = memo(function SheikhIcon({
  size = 16,
  color = colors.accentBrass,
  band = colors.primaryTeal,
  label,
}: {
  size?: number;
  color?: string;
  /** The fold lines — the colour of the tile underneath. */
  band?: string;
  /**
   * Set → the icon is announced as an image with this label (the sheikh's
   * name); unset → decorative, like the brother / niqab icons.
   */
  label?: string;
}) {
  const svg = (
    <Svg width={size} height={size} viewBox="0 0 16 16" accessible={false}>
      <SheikhShapes color={color} band={band} />
    </Svg>
  );
  if (label == null) return svg;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size }}>
      {svg}
    </View>
  );
});
