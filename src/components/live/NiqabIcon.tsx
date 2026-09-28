/**
 * The sister pictogram of «الحلقة» (PLAN_LIVE_V23 §1.1 item 2): a full niqab
 * with ONLY the eyes visible — a sand eye-band with two small eyes, nothing
 * else of the face. Paths copied verbatim from the approved prototype's
 * `<symbol id="pf">`.
 */
import Svg, { Ellipse, Path, Rect } from 'react-native-svg';

import { colors } from '@/constants/theme';

export const NIQAB_BODY =
  'M8 .6C5.3.6 3.6 2.7 3.6 5.3c0 1.6.4 2.6 1 3.4-1.7 1-3 2.9-3 5.5v1.3h12.8v-1.3c0-2.6-1.3-4.5-3-5.5.6-.8 1-1.8 1-3.4C12.4 2.7 10.7.6 8 .6z';
export const NIQAB_EYE_BAND = { x: 4.8, y: 4.1, width: 6.4, height: 2.3, rx: 1.15 } as const;
export const NIQAB_EYES = [
  { cx: 6.7, cy: 5.25, rx: 0.7, ry: 0.55 },
  { cx: 9.3, cy: 5.25, rx: 0.7, ry: 0.55 },
] as const;

/** The raw shapes (no <Svg>), for a `<Symbol viewBox="0 0 16 16">` in the board. */
export function NiqabShapes({ color, eyeBand }: { color: string; eyeBand: string }) {
  return (
    <>
      <Path d={NIQAB_BODY} fill={color} />
      <Rect {...NIQAB_EYE_BAND} fill={eyeBand} />
      {NIQAB_EYES.map((e) => (
        <Ellipse key={e.cx} {...e} fill={color} />
      ))}
    </>
  );
}

export function NiqabIcon({
  size = 16,
  color = colors.primaryTealDeep,
  eyeBand = colors.bgSand,
}: {
  size?: number;
  color?: string;
  /** The visible band around the eyes (the prototype's sand #f3ecdd). */
  eyeBand?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" accessible={false}>
      <NiqabShapes color={color} eyeBand={eyeBand} />
    </Svg>
  );
}
