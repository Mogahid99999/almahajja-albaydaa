/**
 * Small shared visuals of the live UI, ported from the approved prototype:
 *  - `LiveAvatar`   the round person tile (`.pav`) with the brother / niqab icon
 *  - `SheikhAvatar` the teal tile with the brass sheikh pictogram (`.av.k-sheikh`)
 *  - `LiveMarker`   the small live diamond (`.lm`) — static, calm
 *  - `HandGlyph`    the raised-hand stroke icon (Feather has none)
 *  - `VoiceBars`    four quiet voice bars (`.vb`), static
 */
import { View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Rhombus } from '@/components/ui';
import { colors } from '@/constants/theme';
import { BrotherIcon } from './BrotherIcon';
import { NiqabIcon } from './NiqabIcon';
import { SheikhIcon, sheikhIconLabel } from './SheikhIcon';
import { LIVE, type Sex } from './liveUi';

export function LiveAvatar({
  gender,
  size,
  me = false,
  moderator = false,
  style,
}: {
  gender: Sex;
  size: number;
  me?: boolean;
  /** Small brass diamond at the corner (`.pav .mod`). */
  moderator?: boolean;
  style?: ViewStyle;
}) {
  const bg = me ? LIVE.tintMe : gender === 'f' ? LIVE.tintSister : LIVE.tintBrother;
  const border = me
    ? colors.accentBrassMuted
    : gender === 'f'
      ? 'rgba(176,137,79,0.3)'
      : 'rgba(31,74,66,0.14)';
  const icon = Math.round(size * 0.64);
  const iconColor = me
    ? colors.accentBrassMuted
    : gender === 'f'
      ? colors.primaryTealDeep
      : colors.primaryTeal600;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderWidth: me ? 1.5 : 1,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {gender === 'f' ? (
        <NiqabIcon size={icon} color={iconColor} eyeBand={colors.bgSand} />
      ) : (
        <BrotherIcon size={icon} color={iconColor} />
      )}
      {moderator ? (
        <Rhombus
          size={Math.max(7, size * 0.28)}
          color={colors.accentBrass}
          style={{
            position: 'absolute',
            top: -2,
            left: 0,
            borderWidth: 2,
            borderColor: colors.bgSand,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The sheikh's tile: teal disc, brass sheikh pictogram (owner 2026-09-29: an
 * icon, never the name's initial / a number). Announced with his name.
 */
export function SheikhAvatar({ name, size }: { name: string | null | undefined; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primaryTeal,
        borderWidth: 1,
        borderColor: 'rgba(201,164,99,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SheikhIcon
        size={Math.round(size * 0.62)}
        color={colors.accentBrass}
        band={colors.primaryTeal}
        label={sheikhIconLabel(name)}
      />
    </View>
  );
}

export function LiveMarker({ onTeal = false, size = 8 }: { onTeal?: boolean; size?: number }) {
  return <Rhombus size={size} color={onTeal ? LIVE.markerOnTeal : LIVE.marker} />;
}

/** lucide «hand» (the prototype's `ic('hand')`), stroke-drawn on a 24 grid. */
export function HandGlyph({ size, color, strokeWidth = 2.2 }: { size: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {[
        'M18 11V6a2 2 0 0 0-4 0',
        'M14 10V4a2 2 0 0 0-4 0v2',
        'M10 10.5V6a2 2 0 0 0-4 0v8',
        'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
      ].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

const BAR_HEIGHTS = [0.6, 1, 0.75, 0.5];

/** Four quiet voice bars — static on purpose (calm; no bouncing meters). */
export function VoiceBars({ color, height = 14 }: { color: string; height?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height }}>
      {BAR_HEIGHTS.map((h, i) => (
        <View
          key={i}
          style={{ width: 2.5, height: height * h, borderRadius: 2, backgroundColor: color }}
        />
      ))}
    </View>
  );
}
