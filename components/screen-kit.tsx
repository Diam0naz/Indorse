/**
 * components/screen-kit.tsx — Shared primitives for the Indorse field UI
 *
 * Small building blocks that repeat across the Scouting / Provenance /
 * Weather / Profile screens: the card shell, the uppercase monospace section
 * label, the severity pill and the risk bar.
 *
 * Styles are built per palette from `makeStyles(colors)` (internally cached
 * per palette object) so every primitive follows the active theme.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Easing, Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { createStyles, fontSizes, fontWeights, radii, sevFor, spacing, type Colors } from '@/constants/theme'
import { useTheme } from '@/components/theme-provider'

/* ── Card ──────────────────────────────────────────────────────────────────── */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = makeStyles(useTheme().colors)
  return <View style={[styles.card, style]}>{children}</View>
}

/* ── Section label ─────────────────────────────────────────────────────────── */

export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const styles = makeStyles(useTheme().colors)
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>
}

/* ── Mono text ─────────────────────────────────────────────────────────────── */

interface MonoProps {
  children: ReactNode
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
}

export function Mono({ children, size = fontSizes.xs, color, style }: MonoProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return <Text style={[styles.mono, { fontSize: size, color: color ?? colors.textMuted }, style]}>{children}</Text>
}

/* ── Chip ──────────────────────────────────────────────────────────────────── */

export function Chip({
  label,
  color,
  filled = false,
  style,
}: {
  label: string
  color: string
  filled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const styles = makeStyles(useTheme().colors)
  return (
    <View
      style={[
        styles.chip,
        { borderColor: filled ? color : `${color}66`, backgroundColor: filled ? `${color}26` : 'transparent' },
        style,
      ]}
    >
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  )
}

/* ── Severity pill ─────────────────────────────────────────────────────────── */

export function SeverityPill({ severity }: { severity: string }) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const sev = sevFor(colors)
  const c = sev[severity as keyof typeof sev] ?? sev.none
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.pillText, { color: c.text }]}>{c.label}</Text>
    </View>
  )
}

/* ── Risk bar ──────────────────────────────────────────────────────────────── */

export function RiskBar({ value }: { value: number }) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const color = value > 0.5 ? colors.danger : value > 0.25 ? colors.warning : colors.sage
  return (
    <View style={styles.riskRow}>
      <View style={styles.riskTrack}>
        <View
          style={[styles.riskFill, { width: `${Math.min(100, Math.max(0, value * 100))}%`, backgroundColor: color }]}
        />
      </View>
      <Text style={styles.riskValue}>{Math.round(value * 100)}%</Text>
    </View>
  )
}

/* ── Divider ───────────────────────────────────────────────────────────────── */

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = makeStyles(useTheme().colors)
  return <View style={[styles.divider, style]} />
}

/* ── KeyValue row ──────────────────────────────────────────────────────────── */

export function LabelValue({
  label,
  value,
  valueStyle,
}: {
  label: string
  value: string
  valueStyle?: StyleProp<TextStyle>
}) {
  const styles = makeStyles(useTheme().colors)
  return (
    <View style={styles.labelValue}>
      <Text style={styles.labelValueLabel}>{label}</Text>
      <Text style={[styles.labelValueValue, valueStyle]}>{value}</Text>
    </View>
  )
}

/* ── Banner ────────────────────────────────────────────────────────────────── */

export type BannerTone = 'success' | 'warning' | 'danger' | 'info'

function makeTones(colors: Colors): Record<BannerTone, { fg: string; bg: string; border: string }> {
  return {
    success: { fg: colors.sage, bg: `${colors.sage}14`, border: `${colors.sage}44` },
    warning: { fg: colors.warningText, bg: `${colors.warning}18`, border: `${colors.warning}55` },
    danger: { fg: colors.dangerText, bg: `${colors.danger}18`, border: `${colors.danger}55` },
    info: { fg: colors.sky, bg: `${colors.sky}14`, border: `${colors.sky}44` },
  }
}

interface BannerProps {
  tone: BannerTone
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  style?: StyleProp<ViewStyle>
}

export function Banner({ tone, title, message, actionLabel, onAction, style }: BannerProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const c = makeTones(colors)[tone]
  return (
    <View style={[styles.banner, { backgroundColor: c.bg, borderColor: c.border }, style]}>
      <View style={[styles.bannerDot, { backgroundColor: c.fg }]} />
      <View style={styles.bannerBody}>
        <Text style={[styles.bannerTitle, { color: c.fg }]}>{title}</Text>
        {message ? <Text style={styles.bannerMessage}>{message}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.bannerAction, { color: c.fg }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ── Empty state ────────────────────────────────────────────────────────────── */

interface EmptyStateProps {
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  style?: StyleProp<ViewStyle>
}

export function EmptyState({ title, message, actionLabel, onAction, style }: EmptyStateProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <View style={[styles.empty, style]}>
      <View style={styles.emptyIcon}>
        <Svg width={30} height={30} viewBox="0 0 30 30" fill="none">
          <Circle cx={15} cy={15} r={11} stroke={colors.borderMid} strokeWidth={1.5} strokeDasharray="3 4" />
          <Path d="M15 11v8M11 15h8" stroke={colors.textDim} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          style={styles.emptyBtn}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.emptyBtnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ── Error state ────────────────────────────────────────────────────────────── */

interface ErrorStateProps {
  title: string
  message?: string
  retryLabel?: string
  onRetry?: () => void
  style?: StyleProp<ViewStyle>
}

export function ErrorState({ title, message, retryLabel = 'Retry', onRetry, style }: ErrorStateProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <View style={[styles.error, style]}>
      <Svg width={26} height={26} viewBox="0 0 26 26" fill="none">
        <Path d="M13 4.5 22.5 21H3.5L13 4.5z" stroke={colors.danger} strokeWidth={1.6} strokeLinejoin="round" />
        <Path d="M13 11v4.5" stroke={colors.danger} strokeWidth={1.6} strokeLinecap="round" />
        <Circle cx={13} cy={18} r={0.9} fill={colors.danger} />
      </Svg>
      <Text style={styles.errorTitle}>{title}</Text>
      {message ? <Text style={styles.errorMessage}>{message}</Text> : null}
      {onRetry ? (
        <Pressable style={styles.retryBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel={retryLabel}>
          <Text style={styles.retryText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ── Skeleton loader ────────────────────────────────────────────────────────── */

interface SkeletonProps {
  height?: number
  width?: number | `${number}%`
  radius?: number
  style?: StyleProp<ViewStyle>
}

export function Skeleton({ height = 16, width = '100%', radius = radii.sm, style }: SkeletonProps) {
  const { colors } = useTheme()
  const [opacity] = useState(() => new Animated.Value(0.35))

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[{ height, width, borderRadius: radius, backgroundColor: colors.borderMid }, { opacity }, style]}
    />
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const buildStyles = (colors: Colors) =>
  createStyles({
    card: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
    },
    sectionLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: spacing.md,
    },
    mono: {
      fontFamily: 'monospace',
    },
    chip: {
      borderWidth: 1,
      borderRadius: radii.full,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      alignSelf: 'flex-start',
    },
    chipText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    pill: {
      borderWidth: 1,
      borderRadius: radii.xs,
      paddingHorizontal: 6,
      paddingVertical: 2,
      alignSelf: 'flex-start',
    },
    pillText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      letterSpacing: 1.4,
    },
    riskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    riskTrack: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderMid,
      overflow: 'hidden',
    },
    riskFill: {
      height: '100%',
      borderRadius: 2,
    },
    riskValue: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      width: 30,
      textAlign: 'right',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    labelValue: {
      marginBottom: spacing.md,
    },
    labelValueLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 3,
    },
    labelValueValue: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.sky,
    },

    // Banner
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderWidth: 1,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.lg,
    },
    bannerDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      marginTop: 6,
    },
    bannerBody: {
      flex: 1,
      gap: 2,
    },
    bannerTitle: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    bannerMessage: {
      fontSize: fontSizes.sm,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    bannerAction: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      textDecorationLine: 'underline',
    },

    // Empty state
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing['2xl'],
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: radii.full,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    emptyTitle: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    emptyMessage: {
      fontSize: fontSizes.base,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
      maxWidth: 260,
    },
    emptyBtn: {
      marginTop: spacing.md,
      backgroundColor: colors.amber,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    emptyBtnText: {
      color: colors.surface,
      fontSize: fontSizes.base,
      fontWeight: fontWeights.semibold,
    },

    // Error state
    error: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing['2xl'],
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
      backgroundColor: `${colors.danger}10`,
      borderWidth: 1,
      borderColor: `${colors.danger}44`,
      borderRadius: radii.lg,
    },
    errorTitle: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.dangerText,
      textAlign: 'center',
    },
    errorMessage: {
      fontSize: fontSizes.base,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
      maxWidth: 270,
    },
    retryBtn: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: `${colors.danger}88`,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    retryText: {
      color: colors.dangerText,
      fontSize: fontSizes.base,
      fontWeight: fontWeights.semibold,
    },
  })

/** Style sets are identical for identical palettes, so cache per palette. */
const styleCache = new WeakMap<Colors, ReturnType<typeof buildStyles>>()

export function makeStyles(colors: Colors): ReturnType<typeof buildStyles> {
  const cached = styleCache.get(colors)
  if (cached) return cached
  const built = buildStyles(colors)
  styleCache.set(colors, built)
  return built
}
