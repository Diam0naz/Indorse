/**
 * components/help-chip.tsx — the floating robot that opens Ask indorse
 *
 * Mounted once in the tab layout (bottom-left — clear of the Scout dock,
 * which owns the bottom-right): one chip, every screen. The chip knows
 * which screen it floats over through the router pathname and opens the
 * assistant with that screen's most useful first question already asked —
 * "What does the provenance score mean?" on Provenance, "How does the
 * rainfall trigger decide a payout?" on Weather, and so on.
 *
 * The face is the guide's tell: a small line-drawn robot head (antenna,
 * eyes, smile) instead of the old "?" — decorative, the Pressable keeps
 * the accessibility label.
 */

import { useState } from 'react'
import { Pressable } from 'react-native'
import { usePathname } from 'expo-router'
import { AssistantSheet } from '@/components/assistant-sheet'
import { RobotHeadIcon } from '@/components/robot-head-icon'
import { useTheme } from '@/components/theme-provider'
import { createStyles, radii, spacing, type Colors } from '@/constants/theme'
import { useT, type MessageKey } from '@/lib/i18n'

/**
 * The two floating circles have to read as a matched pair, so both of these
 * mirror the Scout dock: `tabBar` in app/(tabs)/_layout.tsx fixes the bar at
 * 90, and the dock's `fabStack` in app/(tabs)/index.tsx hangs spacing.lg
 * above it with a 50-wide `fabCircle`. Copy the numbers from there, never
 * nudge them here alone — a mismatch is exactly what this pair used to look
 * like (a 40 circle sitting 10px low).
 *
 * The chip is deliberately a touch SMALLER than the add circle — it is the
 * secondary control and should not compete with the dock's primary action.
 * Because they differ, bottom edges would no longer imply centred edges, so
 * the chip is lifted by half the diameter gap: bottoms differ, centres do
 * not, and the row still reads level across the two corners.
 */
const TAB_BAR_HEIGHT = 90
/** The dock's add circle (`fabCircle`) — the pair's reference size. */
const DOCK_BUTTON = 50
/** This chip: slightly under the add circle. */
const CHIP_BUTTON = 44
/** Half the gap, so the smaller chip's centre lands on the same line. */
const CHIP_LIFT = (DOCK_BUTTON - CHIP_BUTTON) / 2

/** The question each screen most needs answered first. */
const SCREEN_QUESTIONS: Record<string, MessageKey> = {
  '/': 'assist.q.scout',
  '/farms': 'assist.q.provenance',
  '/reports': 'assist.q.weather',
  '/rewards': 'assist.q.profile',
}

export function HelpChip() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const questionKey = SCREEN_QUESTIONS[pathname] ?? 'assist.q.scout'

  return (
    <>
      <Pressable
        style={styles.chip}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('assist.open')}
      >
        <RobotHeadIcon color={colors.surface} size={18} />
      </Pressable>
      {open ? <AssistantSheet initialQuestion={t(questionKey)} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    chip: {
      position: 'absolute',
      left: spacing.lg,
      // Level with the dock's circle: 90 of tab bar, then the same
      // spacing.lg the dock hangs above it, plus CHIP_LIFT so the smaller
      // diameter still centres on the same line as the add circle.
      bottom: TAB_BAR_HEIGHT + spacing.lg + CHIP_LIFT,
      width: CHIP_BUTTON,
      height: CHIP_BUTTON,
      borderRadius: radii.full,
      backgroundColor: colors.amber,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      zIndex: 10,
    },
  })
