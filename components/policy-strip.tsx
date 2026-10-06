/**
 * components/policy-strip.tsx — the ordered one-policy-per-farm strip
 *
 * A horizontal row of pills, one per roster farm, each carrying that
 * farm's most-recent policy figure ($cover, or an honest no-policy /
 * unreadable marker). Tapping a pill features that farm in the header
 * pill (`registry.setCurrent`) — the strip is a selector, not a second
 * data source: the detail card below stays bound to the WALLET's farm and
 * is labelled with its name, so content and farm can never disagree.
 *
 * Hidden entirely when the roster holds one chain farm or fewer — a
 * single-farm operator (and every test's default context, which reports
 * `farms: []`) sees exactly what they saw before.
 */

import { Pressable, ScrollView, Text } from 'react-native'
import { Card, SectionLabel } from '@/components/screen-kit'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useT } from '@/lib/i18n'
import type { RosterPolicyItem } from '@/features/insurance/useRosterPolicies'

export interface PolicyStripProps {
  items: RosterPolicyItem[]
  currentId: string | null
  onSelect: (farmId: string) => void
}

export function PolicyStrip({ items, currentId, onSelect }: PolicyStripProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  // One farm is not a list — nothing to order, nothing to switch.
  if (items.length <= 1) return null

  return (
    <Card>
      <SectionLabel>{t('wx.strip.title')}</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const selected = item.farmId === currentId
          const detail =
            item.state === 'loading'
              ? '—'
              : item.state === 'unreadable'
                ? t('wx.strip.unreadable')
                : item.policy
                  ? `$${(item.policy.coverageUsdc / 1_000_000).toFixed(0)}`
                  : t('wx.strip.noPolicy')
          return (
            <Pressable
              key={item.farmId}
              onPress={() => onSelect(item.farmId)}
              style={[styles.pill, selected && styles.pillSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${item.farmName}: ${detail}`}
            >
              <Text style={[styles.pillName, selected && styles.pillNameSelected]} numberOfLines={1}>
                {item.farmName}
              </Text>
              <Text style={styles.pillMeta}>{detail}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </Card>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    row: {
      gap: spacing.sm,
      paddingVertical: 2,
    },
    pill: {
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      minWidth: 104,
    },
    // The current farm wears the brand amber so the pill's twin above and
    // the strip selection read as one state.
    pillSelected: {
      borderColor: colors.amber,
      backgroundColor: colors.amberDim,
    },
    pillName: {
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    pillNameSelected: {
      color: colors.amber,
    },
    pillMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
  })
