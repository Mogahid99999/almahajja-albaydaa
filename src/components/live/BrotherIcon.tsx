/**
 * The brother pictogram of «الحلقة» (PLAN_LIVE_V23 §1.1 item 2): a quiet youth
 * silhouette on a 16-unit grid. Paths copied verbatim from the approved
 * prototype's `<symbol id="pm">`.
 */
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/constants/theme';

export const BROTHER_HEAD = { cx: 8, cy: 4.5, r: 3.2 } as const;
export const BROTHER_BODY = 'M2.2 15.5c0-3.6 2.6-6.1 5.8-6.1s5.8 2.5 5.8 6.1z';

/** The raw shapes (no <Svg>), for a `<Symbol viewBox="0 0 16 16">` in the board. */
export function BrotherShapes({ color }: { color: string }) {
  return (
    <>
      <Circle cx={BROTHER_HEAD.cx} cy={BROTHER_HEAD.cy} r={BROTHER_HEAD.r} fill={color} />
      <Path d={BROTHER_BODY} fill={color} />
    </>
  );
}

export function BrotherIcon({
  size = 16,
  color = colors.primaryTeal600,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" accessible={false}>
      <BrotherShapes color={color} />
    </Svg>
  );
}
