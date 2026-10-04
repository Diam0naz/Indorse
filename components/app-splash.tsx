/**
 * components/app-splash.tsx — Launch splash
 *
 * The first thing the app shows: the Indorse mark centred on a rounded card
 * that casts a shadow on the page background, held for `SPLASH_MS` before the
 * root layout swaps it for the auth gate (and, from there, onboarding).
 *
 * It draws itself in its own modal — the same mechanism `AuthGate` uses to
 * cover the navigator — and the root layout mounts one or the other, never
 * both, so there is never a question of which of two modals sits on top.
 */

import { useEffect } from 'react'
import { Modal, Text, View } from 'react-native'
import { IndorseMark } from '@/components/IndorseMark'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, spacing, type Colors } from '@/constants/theme'

/** How long the splash holds before the app underneath takes over. */
const SPLASH_MS = 2000

/** Card edge length in px — close to the native splash's 200 px image width. */
const CARD_SIZE = 200

/** Corner radius as a share of the edge, matching the mark's own tile curve. */
const CARD_RADIUS = CARD_SIZE * 0.22

export function AppSplash({ onDone }: { onDone: () => void }) {
  const { colors, resolved } = useTheme()
  const styles = makeStyles(colors, resolved)

  useEffect(() => {
    const id = setTimeout(onDone, SPLASH_MS)
    return () => clearTimeout(id)
  }, [onDone])

  return (
    <Modal visible animationType="none" statusBarTranslucent>
      <View style={styles.root} testID="app-splash" accessibilityLabel="Indorse">
        <View style={styles.card} testID="app-splash-card">
          {/* Bare mark on the card: the tile would be a rounded rect inside a
              rounded rect, and the light palette wants the ink silhouette. */}
          <IndorseMark size={CARD_SIZE * 0.6} showTile={false} variant={resolved} />
        </View>
        <Text style={styles.wordmark}>indorse</Text>
      </View>
    </Modal>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors, scheme: 'dark' | 'light') =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing['2xl'],
    },
    card: {
      width: CARD_SIZE,
      height: CARD_SIZE,
      borderRadius: CARD_RADIUS,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      // iOS drop shadow. Kept deep and diffuse on dark, soft on paper, so the
      // card reads as lifted off the page in either palette.
      shadowColor: colors.black,
      shadowOpacity: scheme === 'dark' ? 0.6 : 0.18,
      shadowRadius: scheme === 'dark' ? 40 : 24,
      shadowOffset: { width: 0, height: scheme === 'dark' ? 18 : 12 },
      // Android: elevation is the only shadow there.
      elevation: 12,
    },
    wordmark: {
      fontSize: fontSizes['4xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      letterSpacing: -0.6,
    },
  })
