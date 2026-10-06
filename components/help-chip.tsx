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
import { createStyles, type Colors } from '@/constants/theme'
import { useT, type MessageKey } from '@/lib/i18n'

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
        <RobotHeadIcon color={colors.surface} />
      </Pressable>
      {open ? <AssistantSheet initialQuestion={t(questionKey)} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    chip: {
      position: 'absolute',
      left: 16,
      // The tab bar is 90 tall — float just above it.
      bottom: 96,
      width: 40,
      height: 40,
      borderRadius: 20,
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
