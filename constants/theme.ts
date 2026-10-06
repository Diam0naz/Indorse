/**
 * Design tokens — "Indorse" warm palette (light / dark)
 *
 * Three colour families, and nothing else:
 *
 *   Ink     background, surface, surface-alt, text, text-muted, border
 *   Amber   primary, primary-hover   — anything actionable: CTAs, active
 *                                      nav, links and the brand mark
 *   Emerald accent / success         — verified / success states only
 *
 * Restraint rule: amber for actions, emerald for confirmation, everything else
 * a shade of ink. A state that seems to want a fourth hue (pending, expiring…)
 * usually wants `textMuted` plus an icon instead.
 *
 * The three token tables below are the source of truth — dark, light, and the
 * Seeker-exclusive Seeker Midnight:
 *
 *   background, surface, surface-alt, primary, primary-hover, accent,
 *   secondary, text, text-muted, border, success, warning
 *
 * Screens keep using the longer-standing semantic aliases (`bg`, `amber`,
 * `sage`, `sky`, `textPrimary`…), which are derived from those tokens, so
 * adopting the palette never required a call-site sweep. The mapping:
 *
 *   bg            → background
 *   amber         → primary       (amber — CTAs, active tab, links)
 *   sage          → success       (emerald — verified / success only)
 *   sky           → text-muted    (teal dropped; informational text is ink)
 *   accent        → accent        (emerald; `success` shares its value)
 *   textPrimary   → text
 *   textSecondary → text-muted
 *   warning       → primary       (attention stays in the amber family)
 *
 * Typography: two text faces. `fonts.display` (Space Grotesk) carries headings,
 * titles and large numbers (≥ 16px, or a headline-style style key); `fonts.body`
 * (Inter) carries everything smaller — labels, metadata, dense copy — where its
 * taller x-height and even rhythm read better than a geometric face. Monospace
 * and the Great Vibes script stay opt-in via an explicit `fontFamily`.
 */

import { StyleSheet } from 'react-native'

// ── Design-system token tables ─────────────────────────────────────────────

export interface PaletteTokens {
  background: string
  surface: string
  surfaceAlt: string
  primary: string
  primaryHover: string
  accent: string
  secondary: string
  text: string
  textMuted: string
  border: string
  success: string
  warning: string
}

/** Dark palette — the default mode ("Warm Charcoal"). */
export const darkTokens: PaletteTokens = {
  background: '#0E0D0B',
  surface: '#1A1815',
  surfaceAlt: '#231F1A',
  primary: '#F2A340',
  primaryHover: '#FFC169',
  accent: '#34B37E',
  secondary: '#9B968C',
  text: '#F5F3EE',
  textMuted: '#9B968C',
  border: '#2E2A24',
  success: '#34B37E',
  warning: '#F2A340',
}

/** Light palette — "Warm Paper". */
export const lightTokens: PaletteTokens = {
  background: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EFEA',
  primary: '#D97B1E',
  primaryHover: '#B8630F',
  accent: '#0E7A4E',
  secondary: '#6E6B63',
  text: '#151310',
  textMuted: '#6E6B63',
  border: '#E6E4DD',
  success: '#0E7A4E',
  warning: '#D97B1E',
}

// ── Colours ────────────────────────────────────────────────────────────────

/**
 * Dark palette: tokens first, then the derived surface/border shades and the
 * legacy aliases screens already reference.
 *
 * `danger` is the one extra hue the token table does not carry — errors and
 * destructive actions still need it — so it is kept warm and muted per palette
 * so it reads as part of the scheme rather than a fourth brand colour.
 */
export const colors = {
  // Design-system tokens
  background: darkTokens.background,
  surface: darkTokens.surface,
  surfaceAlt: darkTokens.surfaceAlt,
  primary: darkTokens.primary,
  primaryHover: darkTokens.primaryHover,
  accent: darkTokens.accent,
  secondary: darkTokens.secondary,
  text: darkTokens.text,
  success: darkTokens.success,
  warning: darkTokens.warning,

  // Derived surfaces / borders
  bg: darkTokens.background, // alias of `background`
  surfaceDeep: '#090807', // recessed inset (inputs, wells)
  border: darkTokens.border,
  borderMid: '#39332C',
  borderHi: '#463F36',

  // Brand aliases → primary (amber)
  amber: darkTokens.primary, // primary CTA / active tab / links
  amberLight: darkTokens.primaryHover,
  amberDim: 'rgba(242,163,64,0.15)',

  // Success aliases → success (emerald)
  sage: darkTokens.success,
  sageLight: '#5FD3A0',
  sageDim: 'rgba(52,179,126,0.15)',

  // Info aliases → ink (teal dropped: informational text is neutral)
  sky: darkTokens.textMuted,
  skyLight: '#C6C1B7',
  skyDim: 'rgba(155,150,140,0.15)',

  // SOL purple is gone: balances are data, not actions, so they render in ink.
  sol: darkTokens.text,

  // Status
  danger: '#E06B5A',
  dangerText: '#F0947F',
  dangerDim: 'rgba(224,107,90,0.15)',

  // Warning stays in the amber family so attention never adds a hue.
  warningText: darkTokens.warning,
  warningDim: 'rgba(242,163,64,0.15)',

  // Text (text / text-muted are the tokens; the two dimmer steps derive)
  textPrimary: darkTokens.text,
  textSecondary: darkTokens.textMuted,
  textMuted: '#7C776E',
  textDim: '#57534B',

  white: '#ffffff',
  black: '#000000',
} as const

export type Colors = { [K in keyof typeof colors]: string }

/**
 * Light palette — the same tokens inverted for daylight, plus the derived
 * shades. `warningText` darkens the amber for AA contrast on paper.
 */
export const lightColors: Colors = {
  // Design-system tokens
  background: lightTokens.background,
  surface: lightTokens.surface,
  surfaceAlt: lightTokens.surfaceAlt,
  primary: lightTokens.primary,
  primaryHover: lightTokens.primaryHover,
  accent: lightTokens.accent,
  secondary: lightTokens.secondary,
  text: lightTokens.text,
  success: lightTokens.success,
  warning: lightTokens.warning,

  // Derived surfaces / borders
  bg: lightTokens.background, // alias of `background`
  surfaceDeep: '#E9E7E0',
  border: lightTokens.border,
  borderMid: '#DAD7CE',
  borderHi: '#C6C2B7',

  // Brand aliases → primary (amber)
  amber: lightTokens.primary,
  amberLight: lightTokens.primaryHover,
  amberDim: 'rgba(217,123,30,0.12)',

  // Success aliases → success
  sage: lightTokens.success,
  sageLight: '#0B6642',
  sageDim: 'rgba(14,122,78,0.12)',

  // Info aliases → ink (teal dropped)
  sky: lightTokens.textMuted,
  skyLight: '#4A463E',
  skyDim: 'rgba(110,107,99,0.12)',

  // Balances render in ink, matching the dark palette.
  sol: lightTokens.text,

  // Status
  danger: '#B23A2A',
  dangerText: '#96301F',
  dangerDim: 'rgba(178,58,42,0.12)',

  // #D97B1E on paper is ~3:1 — darken the text step for AA.
  warningText: '#9C5A10',
  warningDim: 'rgba(217,123,30,0.16)',

  // Text
  textPrimary: lightTokens.text,
  textSecondary: lightTokens.textMuted,
  textMuted: '#8A857A',
  textDim: '#A9A499',

  white: '#ffffff',
  black: '#000000',
}

/** Seeker tokens — "Seeker Midnight", the device-exclusive dark variant. */
export const seekerTokens: PaletteTokens = {
  background: '#070A0F',
  surface: '#0D1218',
  surfaceAlt: '#141B23',
  primary: '#F2A340',
  primaryHover: '#FFC169',
  accent: '#3DD6A0',
  secondary: '#93A3B5',
  text: '#EEF2F7',
  textMuted: '#93A3B5',
  border: '#1C2530',
  success: '#3DD6A0',
  warning: '#F2A340',
}

/**
 * Seeker Midnight — the same amber-actions / emerald-confirmation discipline
 * as Warm Charcoal, with the ink family pushed cool: warm brown-charcoal
 * becomes blue-black, greys turn steel, emerald cools a step. CTA and success
 * hues stay in their lanes, so nothing that reads "action" or "verified" in
 * the other palettes changes meaning here.
 *
 * Offered only on Seeker devices (`lib/seeker.ts`) — a UI treatment, gated on
 * a spoofable Platform-constants check like every other device exclusive.
 */
export const seekerColors: Colors = {
  // Design-system tokens
  background: seekerTokens.background,
  surface: seekerTokens.surface,
  surfaceAlt: seekerTokens.surfaceAlt,
  primary: seekerTokens.primary,
  primaryHover: seekerTokens.primaryHover,
  accent: seekerTokens.accent,
  secondary: seekerTokens.secondary,
  text: seekerTokens.text,
  success: seekerTokens.success,
  warning: seekerTokens.warning,

  // Derived surfaces / borders
  bg: seekerTokens.background, // alias of `background`
  surfaceDeep: '#040609', // recessed inset (inputs, wells)
  border: seekerTokens.border,
  borderMid: '#28323F',
  borderHi: '#35414F',

  // Brand aliases → primary (amber)
  amber: seekerTokens.primary, // primary CTA / active tab / links
  amberLight: seekerTokens.primaryHover,
  amberDim: 'rgba(242,163,64,0.15)',

  // Success aliases → success (emerald, cooled)
  sage: seekerTokens.success,
  sageLight: '#68E0B4',
  sageDim: 'rgba(61,214,160,0.15)',

  // Info aliases → ink (steel greys)
  sky: seekerTokens.textMuted,
  skyLight: '#C0CCDA',
  skyDim: 'rgba(147,163,181,0.15)',

  // Balances render in ink, matching the other palettes.
  sol: seekerTokens.text,

  // Status
  danger: '#E06B5A',
  dangerText: '#F0947F',
  dangerDim: 'rgba(224,107,90,0.15)',

  // Warning stays in the amber family so attention never adds a hue.
  warningText: seekerTokens.warning,
  warningDim: 'rgba(242,163,64,0.15)',

  // Text (text / text-muted are the tokens; the two dimmer steps derive)
  textPrimary: seekerTokens.text,
  textSecondary: seekerTokens.textMuted,
  textMuted: '#737F8E',
  textDim: '#4A5563',

  white: '#ffffff',
  black: '#000000',
}

// ── Typography ─────────────────────────────────────────────────────────────

/**
 * Google Fonts families, loaded once at the root via `expo-font`.
 * Each weight is its own family name (Google Fonts convention).
 */
export const fonts = {
  display: {
    regular: 'SpaceGrotesk_400Regular',
    medium: 'SpaceGrotesk_500Medium',
    semibold: 'SpaceGrotesk_600SemiBold',
    bold: 'SpaceGrotesk_700Bold',
  },
  body: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
  /**
   * Calligraphic script — reserved for the header greeting. Great Vibes ships
   * a single weight (400), so there is no bold cut to fall back on.
   */
  script: {
    regular: 'GreatVibes_400Regular',
  },
} as const

/**
 * Style keys that always render in the display face, whatever their size.
 *
 * Anchored on purpose: a loose `title` substring would also catch `subtitle`
 * and `bannerMessage`, which are body copy, not headings.
 */
const DISPLAY_KEY = /^(title|screenTitle|pageTitle|heading|headline|display|wordmark|bannerTitle)/
/**
 * Size at or above which a text style switches to the display face.
 *
 * `16` gives the two-face hierarchy the app is designed around: headlines,
 * titles and large numbers take Space Grotesk, and anything smaller — labels,
 * metadata, dense copy — takes Inter. Set it to `0` to put every style in the
 * display face, or raise it to push more of the small type back to Inter.
 */
const DISPLAY_SIZE = 16

function familyFor(weight: unknown, display: boolean): string {
  const face = display ? fonts.display : fonts.body
  const w = String(weight ?? '400').toLowerCase()
  if (w.includes('800') || w.includes('700') || w === 'bold') return face.bold
  if (w.includes('600') || w === 'semibold') return face.semibold
  if (w.includes('500') || w === 'medium') return face.medium
  return face.regular
}

/**
 * `StyleSheet.create` for themed styles, with the type face decided per style:
 *
 *  - text styles without an explicit `fontFamily` get a family from `fonts`;
 *  - ≥ 16px (or a headline-style key) takes the display face, Space Grotesk;
 *    everything smaller takes the body face, Inter;
 *  - an explicit `fontFamily` always wins — `monospace` for addresses, pubkeys
 *    and the tab bar, `fonts.script` for the calligraphic greeting.
 *
 * Use it instead of `StyleSheet.create` inside `makeStyles(colors)` factories.
 */
export function createStyles<S extends StyleSheet.NamedStyles<S>>(styles: S): S {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(styles as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const style = value as Record<string, unknown>
      const size = typeof style.fontSize === 'number' ? style.fontSize : 0
      if (size > 0 && typeof style.fontFamily !== 'string') {
        const display = size >= DISPLAY_SIZE || DISPLAY_KEY.test(key)
        style.fontFamily = familyFor(style.fontWeight, display)
      }
      out[key] = style
    } else {
      out[key] = value
    }
  }
  return StyleSheet.create(out as S)
}

// ── Severity helper maps ───────────────────────────────────────────────────
export interface SeverityStyle {
  bg: string
  border: string
  text: string
  label: string
}

/** Severity pill colours derived from the active palette (theme-aware). */
export function sevFor(c: Colors): Record<'high' | 'medium' | 'low' | 'none', SeverityStyle> {
  return {
    high: { bg: `${c.danger}26`, border: `${c.danger}80`, text: c.dangerText, label: 'HIGH' },
    medium: { bg: `${c.warning}26`, border: `${c.warning}80`, text: c.warningText, label: 'MED' },
    low: { bg: `${c.sky}26`, border: `${c.sky}80`, text: c.skyLight, label: 'LOW' },
    none: { bg: `${c.sage}26`, border: `${c.sage}80`, text: c.sageLight, label: 'CLR' },
  }
}

/** Field status dot + label, derived from the active palette. */
export function fieldStatusFor(c: Colors): Record<'clean' | 'watch' | 'alert', { color: string; label: string }> {
  return {
    clean: { color: c.success, label: 'Clean' },
    watch: { color: c.warning, label: 'Watch' },
    alert: { color: c.danger, label: 'Alert' },
  }
}

/** Notification dot colours per category, derived from the active palette. */
export function notifColorsFor(c: Colors): Record<string, string> {
  return {
    alert: c.dangerText,
    escrow: c.amber, // money movement is a primary-family signal
    weather: c.textMuted, // forecasts are data, not a state
    scout: c.sage,
    system: c.textSecondary,
  }
}

// ── Spacing ────────────────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
} as const

// ── Radii ──────────────────────────────────────────────────────────────────
export const radii = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const

// ── Typography scale ───────────────────────────────────────────────────────
export const fontSizes = {
  xxs: 9,
  xs: 10,
  sm: 11,
  base: 12,
  md: 13,
  lg: 14,
  xl: 16,
  '2xl': 18,
  '3xl': 22,
  '4xl': 26,
  '5xl': 32,
  '6xl': 60,
} as const

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
}
