import Svg, { Line, Polyline } from 'react-native-svg';

/** Typography «Tt» glyph for the reader's font-size button (approved v6 icon). */
export function TextSizeIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="2 7 2 4 14 4 14 7" />
      <Line x1="8" y1="4" x2="8" y2="20" />
      <Line x1="5.5" y1="20" x2="10.5" y2="20" />
      <Polyline points="15 12 15 10 22 10 22 12" />
      <Line x1="18.5" y1="10" x2="18.5" y2="20" />
      <Line x1="16.5" y1="20" x2="20.5" y2="20" />
    </Svg>
  );
}
