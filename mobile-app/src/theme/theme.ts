/**
 * ThreadMyMail Android — Design Tokens
 * =========================================================
 * Social-kit language: deep plum canvases, magenta→violet heroes,
 * white overlapping cards, pill CTAs. Mail-first product, not a meetup app.
 *
 * Usage: import { colors, typography, spacing, radii } from './theme';
 *        const styles = themedStyles(() => ({ ... }));
 * Do NOT hardcode hex values in components — always reference these tokens.
 */

import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

/* ── COLOR PALETTE ─────────────────────────────────────────────────────────── */

/**
 * Nordic-inspired palette.
 *
 * Dark theme uses pure-black OLED (#000000) for maximum battery efficiency.
 * Light theme uses pure-white (#FFFFFF) for maximum vibrancy.
 *
 * Expressive accent: BT Nordic flame (#EA2B16) — a warm, distinctive red that
 * provides just enough contrast without feeling generic startup color.
 *
 * Neutral text scales are engineered for the specific base colors:
 * - On pure white: needs darker grays for readability
 * - On pure black: needs lighter grays to avoid eye strain
 */

export const darkPalette = {
  // ── Backgrounds (plum night, matching the kit) ────────────────────────────
  bg: '#160C28',
  bgDeep: '#0E071C',
  bgSurface: '#241536',
  bgSurfaceHover: '#2E1B44',

  // ── Text ──────────────────────────────────────────────────────────────────
  text: '#F7F2FF',
  textMuted: '#C4B4D8',
  textSubtle: '#8E7AA8',
  textOnAccent: '#FFFFFF',
  textOnPrimary: '#FFFFFF',

  // ── Primary (magenta → violet) ────────────────────────────────────────────
  primary: '#E84B8A',
  primaryText: '#FFD0E4',
  primaryDark: '#C0266A',
  primaryBg: 'rgba(232, 75, 138, 0.16)',

  // ── Secondary ─────────────────────────────────────────────────────────────
  secondary: '#7B5CFF',

  // ── Semantic states ───────────────────────────────────────────────────────
  danger: '#FF3B30',       // stop/delete — native red, highly recognizable
  dangerText: '#FFCDD2',   // readable danger text on dark surfaces
  dangerBg: 'rgba(255, 59, 48, 0.12)',

  success: '#34C759',      // enabled/connected/success — native green
  successText: '#A7F3D0',   // readable success text on dark surfaces
  successBg: 'rgba(52, 199, 89, 0.12)',

  warn: '#FF9500',         // warnings, notifications
  warnText: '#FFE0B2',     // readable warning text on dark surfaces
  warnBg: 'rgba(255, 149, 0, 0.12)',

  // ── Tertiary (utility colors) ─────────────────────────────────────────────
  info: '#007AFF',         // informational
  infoText: '#B8E0FF',
  infoBg: 'rgba(0, 122, 255, 0.12)',

  // ── Borders ───────────────────────────────────────────────────────────────
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.16)',
  borderPrimary: 'rgba(232, 75, 138, 0.55)',

  // ── Overlays ──────────────────────────────────────────────────────────────
  overlay: 'rgba(0,0,0,0.75)', // modal backdrop (darker for OLED: black base)
  scrim: 'rgba(0,0,0,0.55)',   // bottom-sheet scrim

  // ── Decorative (minimal use) ─────────────────────────────────────────────
  sparkle: '#FFD700',      // subtle star, cautionary per use

  // ── Overlay dim RGB triplet (for wallpaper dim overlay) ─────────────────
  dimRgb: '0,0,0',
};

export type ColorPalette = typeof darkPalette;

/**
 * Light theme — same semantic roles, adapted for white base.
 *
 * On pure white, text needs to be darker to meet WCAG AA.
 */
export const lightPalette: ColorPalette = {
  bg: '#F6F1FB',
  bgDeep: '#FFFFFF',
  bgSurface: '#FFFFFF',
  bgSurfaceHover: '#F0E8F8',

  text: '#1B1030',
  textMuted: '#6B5A7A',
  textSubtle: '#9A8890',
  textOnAccent: '#FFFFFF',
  textOnPrimary: '#FFFFFF',

  primary: '#D946A0',
  primaryText: '#9D174D',
  primaryDark: '#A21CAF',
  primaryBg: 'rgba(217, 70, 160, 0.12)',

  secondary: '#7C3AED',

  // ── Semantic states ───────────────────────────────────────────────────────
  danger: '#DC2626',       // stop/delete
  dangerText: '#FCA5A5',
  dangerBg: 'rgba(220, 38, 38, 0.10)',

  success: '#16A34A',      // enabled/connected
  successText: '#86EFAC',
  successBg: 'rgba(22, 163, 74, 0.10)',

  warn: '#F97316',         // warnings
  warnText: '#FDBA74',
  warnBg: 'rgba(249, 115, 22, 0.10)',

  // ── Tertiary ─────────────────────────────────────────────────────────────
  info: '#0066CC',         // informational
  infoText: '#BFDBFE',
  infoBg: 'rgba(0, 102, 204, 0.10)',

  // ── Borders ───────────────────────────────────────────────────────────────
  border: 'rgba(27, 16, 48, 0.08)',
  borderStrong: 'rgba(27, 16, 48, 0.14)',
  borderPrimary: 'rgba(217, 70, 160, 0.45)',

  // ── Overlays ──────────────────────────────────────────────────────────────
  overlay: 'rgba(0,0,0,0.4)', // lighter for white base
  scrim: 'rgba(0,0,0,0.3)',

  // ── Decorative (minimized on light) ───────────────────────────────────────
  sparkle: '#FFA500',

  // ── Overlay dim RGB triplet (for wallpaper dim overlay) ─────────────────
  dimRgb: '255,255,255',
};

export const palettes = { dark: darkPalette, light: lightPalette };

// ── THEME STATE ────────────────────────────────────────────────────────────

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

/* ── TYPOGRAPHY (system fonts) ───────────────────────────────────────────── */

/**
 * System fonts: native iOS (SF Pro) / Android (Roboto/system-ui).
 *
 * No custom font families — this keeps the app lightweight and ensures
 * native feel across both platforms without additional downloads.
 *
 * Hierarchy:
 * - Display: Large bold headings, tight tracking
 * - H1: Main screen titles
 * - H2: Section headers
 * - H3: Subsection headers
 * - Body: Secondary text, descriptions
 * - BodySmall: Fine print, captions
 * - Label: Uppercase, disciplined 1.2 tracking
 * - Caption: Tiny utility text
 * - Mono: IDs, SHAs, tool outputs
 */
export const typography = {
  // System fonts using native stack
  fontFamily: 'system-ui',

  // ── Display ────────────────────────────────────────────────────────────────
  display: { fontSize: 34, fontWeight: '700', letterSpacing: -1.5 },

  // ── Headings ───────────────────────────────────────────────────────────────
  h1: { fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '600', letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '600', letterSpacing: -0.2 },

  // ── Body ────────────────────────────────────────────────────────────────────
  body: { fontSize: 16, fontWeight: '400', letterSpacing: 0 },
  bodySmall: { fontSize: 14, fontWeight: '400', letterSpacing: 0 },

  // ── Labels ──────────────────────────────────────────────────────────────────
  label: { fontSize: 11, fontWeight: '500', letterSpacing: 1.25, textTransform: 'uppercase' },
  caption: { fontSize: 11, fontWeight: '400', letterSpacing: 0 },

  // ── Mono (technical output) ─────────────────────────────────────────────────
  mono: { fontFamily: 'SF Mono, ui-monospace, Menlo, monospace', fontSize: 12 },
} as const;

/* ── SPACING ───────────────────────────────────────────────────────────────── */

/**
 * Responsive spacing scale (8-point grid).
 *
 * Measurements in pixels.
 * - Scale: 4, 8, 12, 16, 24, 32 — all multiples of 4
 * - Screen gutters: 16px (conservative for OLED)
 * - Bottom nav: 56px (safe area + touch target)
 * - Top bar: 56px
 */
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
  tabBar: 56,
  // Top bar height
  header: 56,
  // Safe area padding (will be added dynamically with useSafeAreaInsets)
  safeTop: 8,
  safeBottom: 8,
} as const;

/* ── RADIUS ───────────────────────────────────────────────────────────────── */

/**
 * Corner radius rules — restrained, not pill-shaped.
 *
 * Measurements scaled across platforms while maintaining relative ratios.
 * - sm: 8px (buttons, items)
 * - md: 12px (cards, lists)
 * - lg: 16px (elevated surfaces)
 * - xl: 20px (sheet top corners)
 * - pill: 999px (horizontal scroll pills, badges)
 */
export const radii = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 28,
  pill: 999,
} as const;

/* ── SHADOWS (Emission-based) ─────────────────────────────────────────────── */

/**
 * Subtle emission-based shadows.
 *
 * Shadows on OLED: non-transparent glow from content, not spread.
 * Used sparingly for surface elevation indicators.
 */
export const shadows = {
  // Subtle elevation for cards (no spread, just emission)
  card: {
    shadowColor: colors.primary,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  // Floating elements (FAB, raised actions)
  float: {
    shadowColor: colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  // Inset/GUI shadows (divider lines, placeholders)
  inset: {
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 0,
  },
} as const;

/* ── TOUCH TARGETS ─────────────────────────────────────────────────────────── */

/**
 * Touch target minimums (Android 48dp standard).
 *
 * - minTarget: 48 (minimum touch target)
 * - gap: 8 (comfortable spacing between targets)
 * - Computed: minHeight = miniTarget, iPad/bypass friendly
 */
export const touch = {
  minTarget: 48,
  gap: 8,
} as const;

/* ── MOTION ────────────────────────────────────────────────────────────────── */

/**
 * Motion durations — native-feeling, not exaggerated.
 *
 * - fast: 100-150ms (micro-turns, presses)
 * - base: 200-250ms (standard transitions)
 * - slow: 300-400ms (bigger flows)
 *
 * Reduced-motion: 300ms baseline should be respected.
 */
export const motion = {
  fast: 150,
  base: 200,
  slow: 300,
} as const;

/* ── ICON SIZES ───────────────────────────────────────────────────────────── */

/**
 * Icon sizes for common usages.
 *
 * - buttons: 24px (primary actions)
 * - icons: 20px (tab icons, contextual actions)
 * - controls: 18px (optional controls, secondary actions)
 * - decorative: 16px (micro-decorations)
 */
export const icon = {
  button: 24,
  icon: 20,
  control: 18,
  decorative: 16,
} as const;

/* ── LAYOUT GUIDELINES ───────────────────────────────────────────────────── */

/**
 * Base screen dimensions (common Android sizes).
 */
export const screen = {
  small: 360,  // Small phone (Pixel 3a, etc.)
  medium: 393, // Standard (Pixel 4a, etc.)
  large: 430,  // Large (Pixel 5, etc.)
  extraLarge: 480, // Foldables, large phablets
} as const;

/**
 * Safe area aware portrait orientation.
 */
export const orientation = {
  portrait: {
    small: { width: screen.small, height: 693 },
    medium: { width: screen.medium, height: 852 },
    large: { width: screen.large, height: 932 },
  },
  landscape: {
    small: { width: 693, height: screen.small },
    medium: { width: 852, height: screen.medium },
    large: { width: 932, height: screen.large },
  },
} as const;

/* ── COMPLETE THEME OBJECT ─────────────────────────────────────────────────── */

/**
 * The complete theme object for a single import.
 */
export const theme = {
  colors,
  typography,
  spacing,
  radii,
  shadows,
  touch,
  motion,
  icon,
  screen,
  orientation,
} as const;

export default theme;

/* ── THEMED STYLES FACTORY ───────────────────────────────────────────────── */

/**
 * Theme-aware StyleSheet.create: the factory runs lazily the first time a style
 * is read and is rebuilt whenever the active palette changes. This keeps module
 * level `const styles = themedStyles(() => ({...}))` declarations while making
 * every color token live.
 *
 * @example
 * const styles = themedStyles(() => ({
 *   card: {
 *     backgroundColor: colors.bgSurface,
 *     borderRadius: radii.md,
 *     padding: spacing.lg,
 *   },
 * }));
 *
 * @returns A Proxy that resolves tokens against the active palette
 */
export function themedStyles<T extends { [P in keyof T]: ViewStyle | TextStyle | ImageStyle }>(
  factory: () => T
): T {
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