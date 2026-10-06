/**
 * ThreadMyMail Mobile — Design Tokens (Expo / React Native)
 * =========================================================
 * Source of truth for the Android harness UI. Dark-first per MVP-UI.md §1.
 * Palette derived from the UI/UX Pro Max design database (AI-Native UI):
 *   primary #7C3AED · secondary #A78BFA · accent #0891B2
 * Typography: Inter 300–700 (single-family precision system).
 *
 * Usage: import { colors, typography, spacing, radii, shadows } from './theme';
 * Do NOT hardcode hex values in components — always reference these tokens.
 */

export const colors = {
  // ── Backgrounds (dark cockpit — MVP-UI.md §1) ──────────────────────────
  bg: '#0B1326',            // app background
  bgDeep: '#060E20',        // deepest layer (gradient end)
  surface: 'rgba(255,255,255,0.06)',   // cards, sheets
  surfaceStrong: 'rgba(255,255,255,0.10)', // elevated surfaces
  surfaceHover: 'rgba(255,255,255,0.12)',  // pressed/hover states

  // ── Text ────────────────────────────────────────────────────────────────
  text: '#F1F5F9',          // primary text
  textMuted: '#94A3B8',     // secondary text
  textSubtle: '#64748B',    // tertiary / captions
  textOnPrimary: '#FFFFFF', // text on primary buttons
  textOnAccent: '#000000',  // text on accent (cyan) buttons

  // ── Brand (AI-Native palette) ───────────────────────────────────────────
  primary: '#7C3AED',       // AI actions, active tab, primary buttons
  primaryDark: '#6D28D9',   // pressed state
  secondary: '#A78BFA',     // secondary actions, highlights
  accent: '#0891B2',        // CTA, links, "needs your eye" items
  accentDark: '#0E7490',    // pressed state

  // ── Semantic states ─────────────────────────────────────────────────────
  danger: '#DC2626',        // kill switch, destructive, errors
  dangerBg: 'rgba(220,38,38,0.12)',
  success: '#16A34A',       // live / connected / done
  successBg: 'rgba(22,163,74,0.12)',
  warn: '#D97706',          // warnings, quiet hours
  warnBg: 'rgba(217,119,6,0.12)',

  // ── Borders ─────────────────────────────────────────────────────────────
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  borderPrimary: 'rgba(124,58,237,0.35)', // focus ring / active outlines

  // ── Overlays ────────────────────────────────────────────────────────────
  overlay: 'rgba(6,14,32,0.72)',   // modal backdrop
  scrim: 'rgba(6,14,32,0.55)',     // bottom-sheet scrim
} as const;

export type ColorToken = keyof typeof colors;

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
