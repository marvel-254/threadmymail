/**
 * ThreadMyMail Mobile — Design Tokens (Expo / React Native)
 * =========================================================
 * Source of truth for the Android harness UI. Dark-first per MVP-UI.md §1.
 * Palette derived from the UI/UX Pro Max design database (AI-Native UI):
 *   primary #7C3AED · secondary #A78BFA · accent #0891B2
 * Typography: Inter 300–700 (single-family precision system).
 *
 * Usage: import { colors, typography, spacing, radii, shadows } from './theme';
 *        const styles = themedStyles(() => ({ ... }));
 * Do NOT hardcode hex values in components — always reference these tokens.
 */

import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Semantic palettes. Components never branch on the theme — they read the same
 * token names, and the active palette is swapped underneath them.
 */
export const darkPalette = {
  // ── Backgrounds (dark cockpit — MVP-UI.md §1) ──────────────────────────
  bg: '#0B1326',            // app background
  bgDeep: '#060E20',        // deepest layer (gradient end)
  surface: 'rgba(255,255,255,0.06)',   // cards, sheets
  surfaceStrong: 'rgba(255,255,255,0.10)', // elevated surfaces
  surfaceHover: 'rgba(255,255,255,0.12)',  // pressed/hover states

  // ── Text ────────────────────────────────────────────────────────────────
  text: '#F1F5F9',          // primary text
  textMuted: '#94A3B8',     // secondary text
  textSubtle: '#8A9AB0',    // tertiary / captions
  textOnPrimary: '#FFFFFF', // text on primary buttons
  textOnAccent: '#000000',  // text on accent (cyan) buttons

  // ── Brand (AI-Native palette) ───────────────────────────────────────────
  primary: '#7C3AED',       // AI actions, active tab, primary buttons
  primaryText: '#A78BFA',   // primary-colored text/icons on dark surfaces
  primaryDark: '#6D28D9',   // pressed state
  secondary: '#A78BFA',     // secondary actions, highlights
  accent: '#0891B2',        // CTA, links, "needs your eye" items
  accentDark: '#0E7490',    // pressed state
  accentBg: 'rgba(8,145,178,0.14)',
  primaryBg: 'rgba(124,58,237,0.14)',

  // ── Semantic states ─────────────────────────────────────────────────────
  danger: '#DC2626',        // kill switch, destructive, errors
  dangerText: '#F87171',    // readable danger text/icons on dark surfaces
  dangerBg: 'rgba(220,38,38,0.12)',
  success: '#16A34A',       // live / connected / done
  successText: '#4ADE80',   // readable success text/icons on dark surfaces
  successBg: 'rgba(22,163,74,0.12)',
  warn: '#D97706',          // warnings, quiet hours
  warnText: '#FBBF24',      // readable warning text/icons on dark surfaces
  warnBg: 'rgba(217,119,6,0.12)',

  // ── Borders ─────────────────────────────────────────────────────────────
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  borderPrimary: 'rgba(124,58,237,0.35)', // focus ring / active outlines

  // ── Overlays ────────────────────────────────────────────────────────────
  overlay: 'rgba(6,14,32,0.72)',   // modal backdrop
  scrim: 'rgba(6,14,32,0.55)',     // bottom-sheet scrim
  dimRgb: '6,14,32',               // wallpaper dim overlay base (RGB triplet)
};

export type ColorPalette = typeof darkPalette;

/**
 * Light palette: same semantic roles, tuned for daylight. Body and label colors
 * meet WCAG AA on `bg`/`surface`; brand hues are darkened where the dark values
 * would fail (primary, accent, semantic states).
 */
export const lightPalette: ColorPalette = {
  bg: '#F6F7FB',
  bgDeep: '#FFFFFF',
  surface: 'rgba(15,23,42,0.04)',
  surfaceStrong: 'rgba(15,23,42,0.07)',
  surfaceHover: 'rgba(15,23,42,0.10)',

  text: '#0F172A',
  textMuted: '#475569',
  textSubtle: '#526276',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  primary: '#6D28D9',
  primaryText: '#6D28D9',
  primaryDark: '#5B21B6',
  secondary: '#7C3AED',
  accent: '#0E7490',
  accentDark: '#155E75',
  accentBg: 'rgba(14,116,144,0.12)',
  primaryBg: 'rgba(109,40,217,0.10)',

  danger: '#B91C1C',
  dangerText: '#B91C1C',
  dangerBg: 'rgba(185,28,28,0.10)',
  success: '#15803D',
  successText: '#15803D',
  successBg: 'rgba(21,128,61,0.10)',
  warn: '#B45309',
  warnText: '#B45309',
  warnBg: 'rgba(180,83,9,0.10)',

  border: 'rgba(15,23,42,0.12)',
  borderStrong: 'rgba(15,23,42,0.22)',
  borderPrimary: 'rgba(109,40,217,0.35)',

  overlay: 'rgba(15,23,42,0.35)',
  scrim: 'rgba(15,23,42,0.30)',
  dimRgb: '15,23,42',
};

export const palettes = { dark: darkPalette, light: lightPalette };

let activePalette: ColorPalette = darkPalette;

/** Called by ThemeProvider before rendering the tree. */
export function setActivePalette(next: ColorPalette): void {
  activePalette = next;
}

export function getActivePalette(): ColorPalette {
  return activePalette;
}

/**
 * Live token proxy. Static `colors.x` reads resolve against the active palette,
 * so every component keeps the plain `colors` import while still following the
 * theme. Re-render is driven by ThemeProvider.
 */
export const colors: ColorPalette = new Proxy(darkPalette, {
  get(_target, key: string | symbol) {
    return activePalette[key as keyof ColorPalette];
  },
  ownKeys() {
    return Reflect.ownKeys(activePalette);
  },
  getOwnPropertyDescriptor(_target, key: string | symbol) {
    return {
      enumerable: true,
      configurable: true,
      value: activePalette[key as keyof ColorPalette],
    };
  },
}) as ColorPalette;

export type ColorToken = keyof ColorPalette;

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Theme-aware `StyleSheet.create`: the factory runs lazily the first time a
 * style is read and is rebuilt whenever the active palette changes. This keeps
 * module-level `const styles = themedStyles(() => ({...}))` declarations while
 * making every color token live.
 */
export function themedStyles<T extends NamedStyles<T>>(factory: () => T): T {
  let cachedPalette: ColorPalette | null = null;
  let cached: T | null = null;
  return new Proxy({} as T, {
    get(_target, key: string | symbol) {
      if (!cached || cachedPalette !== activePalette) {
        cachedPalette = activePalette;
        cached = StyleSheet.create(factory()) as unknown as T;
      }
      return (cached as Record<string | symbol, unknown>)[key];
    },
  });
}

export const typography = {
  // Inter — single family, precision system (DB: Modern Dark Cinema)
  fontFamily: 'Inter',
  // Display / hero
  display: { fontSize: 34, fontWeight: '700', letterSpacing: -1.5 },
  // Headings
  h1: { fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '600', letterSpacing: -0.5 },
  h3: { fontSize: 18, fontWeight: '600', letterSpacing: -0.3 },
  // Body
  body: { fontSize: 16, fontWeight: '400', letterSpacing: 0 },
  bodySmall: { fontSize: 14, fontWeight: '400', letterSpacing: 0 },
  // Labels / captions (uppercase +1.2 tracking)
  label: { fontSize: 12, fontWeight: '500', letterSpacing: 1.2, textTransform: 'uppercase' },
  caption: { fontSize: 12, fontWeight: '400', letterSpacing: 0 },
  // Mono (run IDs, SHAs, tool args)
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  // Screen gutters
  screen: 16,
  // Bottom nav height
  tabBar: 64,
  // Top bar height
  header: 56,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,     // cards, sheets (matches web --radius)
  pill: 999,
} as const;

export const shadows = {
  // Subtle elevation for cards (dark mode: subtle/none per DB)
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // Floating elements (bottom nav, FAB)
  float: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

/** Touch target minimums (Android 48dp, 8px gap — DB UX rule). */
export const touch = {
  minTarget: 48,
  gap: 8,
} as const;

/** Motion durations (DB: 150–300ms; reduced-motion respected). */
export const motion = {
  fast: 150,
  base: 200,
  slow: 300,
} as const;

/** The complete theme object for a single import. */
export const theme = { colors, typography, spacing, radii, shadows, touch, motion };
export default theme;
