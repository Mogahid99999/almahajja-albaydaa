/**
 * Design tokens — manuscript-inspired, warm & muted.
 * Source of truth: README.md › Design Tokens (synced from Claude Design).
 *
 * Calm and serious — two background colors max, no bright/competitive colors,
 * no gamification.
 */
import { Platform } from 'react-native';

export const colors = {
  // Backgrounds & surfaces
  bgSand: '#f3ecdd',
  bgSandRaised: '#f8f3e8',
  surfaceCard: '#fbf7ed',
  surfaceWhite: '#ffffff',
  surfaceInset: '#e9e0cd',
  surfaceTrack: '#ece3cf',

  // Brand teal
  primaryTeal: '#1f4a42',
  primaryTealDeep: '#16352f',
  primaryTeal600: '#2c6157',

  // Brass accents
  accentBrass: '#c9a463',
  accentBrassMuted: '#b0894f',
  accentBrassSoft: '#cbb98e',

  // Text
  textInk: '#2b2723',
  textSlate: '#5c5343',
  textMuted: '#6b6253',
  textFaint: '#897a5d',
  textGhost: '#9a8f7c',

  // Borders
  borderSand: '#e8ddc6',
  borderSand2: '#ddd1b7',
  borderHair: '#ece3cf',

  // State
  stateSuccess: '#1f8a5b',
  stateDanger: '#b85c4a',

  // On-teal surfaces
  onTealPrimary: '#f6f0e2',
  onTealSecondary: '#a9bdb6',
  onTealIcon: '#dfe7e3',
} as const;

/**
 * Font family names map to the keys registered by @expo-google-fonts (loaded in
 * app/_layout.tsx). Use `fonts.display` for Amiri titles, `fonts.body*` for UI.
 */
export const fonts = {
  /** Amiri 700 — screen/section/lecture titles, large emblems. */
  display: 'Amiri_700Bold',
  /** Amiri 400 — lighter serif accents. */
  displayRegular: 'Amiri_400Regular',
  /** IBM Plex Sans Arabic — UI/body. */
  body: 'IBMPlexSansArabic_400Regular',
  bodyMedium: 'IBMPlexSansArabic_500Medium',
  bodySemibold: 'IBMPlexSansArabic_600SemiBold',
  bodyBold: 'IBMPlexSansArabic_700Bold',
} as const;

export const radius = {
  sm: 11,
  input: 12,
  card: 18,
  feature: 22,
  artwork: 30,
  pill: 999,
} as const;

export const spacing = {
  screenH: 22, // mobile horizontal screen padding
  adminContent: 30,
} as const;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Shadow-only style keys — deliberately NOT typed as ViewStyle/TextStyle so
 * this spreads cleanly into either (this app spreads shadow presets into both
 * View and TextInput style objects).
 */
type ShadowStyle = {
  boxShadow?: string;
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
};

/**
 * Cross-platform drop shadow. Native (iOS/Android) keeps the real shadow
 * style props (shadowColor etc.) and elevation; web uses `boxShadow` directly
 * instead — react-native-web renders the shadow shorthand fine today but logs
 * a deprecation warning for it, and this produces the identical visual shadow
 * without that noise.
 */
export function platformShadow(
  color: string,
  offset: { width: number; height: number },
  opacity: number,
  radius: number,
  elevation?: number,
): ShadowStyle {
  return Platform.select<ShadowStyle>({
    web: { boxShadow: `${offset.width}px ${offset.height}px ${radius}px ${hexToRgba(color, opacity)}` },
    default: {
      shadowColor: color,
      shadowOffset: offset,
      shadowOpacity: opacity,
      shadowRadius: radius,
      ...(elevation !== undefined ? { elevation } : {}),
    },
  })!;
}

/**
 * Soft, brand-tinted shadows only (README › Spacing/shadow). RN approximations
 * of the long low-opacity CSS shadows; never hard or neutral-gray.
 */
export const shadows = {
  feature: platformShadow('#1f4a42', { width: 0, height: 14 }, 0.35, 18, 8),
  miniPlayer: platformShadow('#16352f', { width: 0, height: 14 }, 0.45, 18, 12),
  button: platformShadow('#1f4a42', { width: 0, height: 8 }, 0.35, 10, 5),
  /** Subtle focus glow — no elevation (Android never showed one for this either). */
  subtle: platformShadow(colors.primaryTeal, { width: 0, height: 0 }, 0.1, 3),
  /** Raised popover/dropdown shadow. */
  raised: platformShadow(colors.primaryTeal, { width: 0, height: 8 }, 0.18, 20, 12),
} as const;
