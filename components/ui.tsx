/**
 * Shared UI primitives.
 *
 * The feature cards (Farm, Report, Harvest, Escrow) all render the same
 * skeleton — a dark rounded card, label/value field grids and a colored
 * status badge — so those pieces live here once.
 *
 * NOTE: every className is a complete string literal (via ternaries, never
 * interpolation) so the Tailwind transformer can extract classes at build
 * time. Dynamically composed class names compile to no styles on native.
 */

import { View, Text } from 'react-native'
import type { ReactNode } from 'react'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme } from '@/components/theme-provider'

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode
  /** Whole-card description for screen readers */
  accessibilityLabel?: string
  /** Vertical gap between sections: 'sm' (8px) or 'md' (12px) */
  gap?: 'sm' | 'md'
}

export function Card({ children, accessibilityLabel, gap = 'sm' }: CardProps) {
  return (
    <View
      className={gap === 'md' ? 'bg-surface-alt rounded-xl p-4 gap-3' : 'bg-surface-alt rounded-xl p-4 gap-2'}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </View>
  )
}

// ── FieldGrid ─────────────────────────────────────────────────────────────────

interface FieldGridProps {
  /** Array of [label, value] pairs, laid out in a responsive row */
  fields: [string, string][]
  /** Text size class for values */
  size?: 'xs' | 'sm'
}

export function FieldGrid({ fields, size = 'sm' }: FieldGridProps) {
  return (
    <View className="flex-row gap-4">
      {fields.map(([label, value]) => (
        <View key={label} className="flex-1">
          <Text className="font-sans text-ink-muted text-xs">{label}</Text>
          <Text
            className={size === 'xs' ? 'font-sans text-ink text-xs' : 'font-sans text-ink text-sm'}
            numberOfLines={1}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────

const BADGE_ICONS: Record<string, string> = {
  pending: 'hourglass-half',
  verified: 'check-circle',
  rejected: 'times-circle',
  funded: 'lock',
  released: 'check-circle',
  cancelled: 'times-circle',
  active: 'check-circle',
  paidOut: 'money-bill-wave',
  expired: 'hourglass',
}

const BADGE_LABELS: Record<string, string> = {
  pending: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
  funded: 'Funded',
  released: 'Released',
  cancelled: 'Cancelled',
  active: 'Active',
  paidOut: 'Paid out',
  expired: 'Expired',
}

/**
 * Status → tone. Restraint rule: emerald means confirmed, amber means money in
 * motion, red means failed/aborted, and "waiting" states (pending, expired)
 * stay neutral ink rather than inventing a fourth hue.
 */
const BADGE_TONE: Record<string, 'primary' | 'accent' | 'danger' | 'muted'> = {
  pending: 'muted',
  verified: 'accent',
  rejected: 'danger',
  funded: 'primary',
  released: 'accent',
  cancelled: 'danger',
  active: 'accent',
  paidOut: 'accent',
  expired: 'muted',
}

const BADGE_CLASS: Record<'primary' | 'accent' | 'danger' | 'muted', string> = {
  primary: 'font-sans text-sm font-medium text-primary',
  accent: 'font-sans text-sm font-medium text-accent',
  danger: 'font-sans text-sm font-medium text-danger',
  muted: 'font-sans text-sm font-medium text-ink-muted',
}

interface BadgeProps {
  /** Status name — also used to pick the color and friendly label */
  status: string
}

export function Badge({ status }: BadgeProps) {
  const { colors } = useTheme()
  const tone = BADGE_TONE[status] ?? 'muted'

  const badgeColor =
    tone === 'primary'
      ? colors.amber
      : tone === 'accent'
        ? colors.accent
        : tone === 'danger'
          ? colors.dangerText
          : colors.textMuted

  const iconName = BADGE_ICONS[status]
  const label = BADGE_LABELS[status] ?? status

  return (
    <View className="flex-row items-center gap-1">
      {iconName && <FontAwesome5 name={iconName} size={14} color={badgeColor} />}
      <Text className={BADGE_CLASS[tone]}>{label}</Text>
    </View>
  )
}
