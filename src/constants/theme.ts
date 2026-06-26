/**
 * Design tokens — manuscript-inspired, warm & muted.
 * Source of truth: README.md › Design Tokens (synced from Claude Design).
 *
 * Calm and serious — two background colors max, no bright/competitive colors,
 * no gamification.
 */

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
  bodyLight: 'IBMPlexSansArabic_300Light',
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

/**
 * Soft, brand-tinted shadows only (README › Spacing/shadow). RN approximations
 * of the long low-opacity CSS shadows; never hard or neutral-gray.
 */
export const shadows = {
  feature: {
    shadowColor: '#1f4a42',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  miniPlayer: {
    shadowColor: '#16352f',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 12,
  },
  button: {
    shadowColor: '#1f4a42',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
} as const;
