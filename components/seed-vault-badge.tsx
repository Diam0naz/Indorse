/**
 * components/seed-vault-badge.tsx — "Seed Vault secured" chip
 *
 * A small reassurance chip for the scout camera: on a Seeker, transaction
 * signing keys live in the device's Seed Vault, so the capture about to be
 * submitted is anchored to hardware-protected keys.
 *
 * Presentation only — it renders from `isSeekerDevice()`, a spoofable
 * Platform-constants check, so it never gates anything. Verifying a device
 * for real is a server-side SIWS + Seeker Genesis Token check.
 *
 * Returns `null` off-Seeker, so callers can drop it in unconditionally.
 */

import { Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { isSeekerDevice } from '@/lib/seeker'
import { useT } from '@/lib/i18n'

export function SeedVaultBadge() {
  const { colors } = useTheme()
  const t = useT()
  if (!isSeekerDevice()) return null
  const styles = makeStyles(colors)

  return (
    <View style={styles.chip}>
      <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
        {/* Padlock: shackle over a body — the Seed Vault mark. */}
        <Path
          d="M3.75 5V3.75a2.25 2.25 0 0 1 4.5 0V5"
          stroke={colors.sageLight}
          strokeWidth={1.2}
          strokeLinecap="round"
        />
        <Path
          d="M2.75 5h6.5v4.25a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1-.75-.75V5Z"
          stroke={colors.sageLight}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.label}>{t('scout.cam.seedVault')}</Text>
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'center',
      marginTop: spacing.sm,
      backgroundColor: colors.sageDim,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: `${colors.sage}55`,
      paddingVertical: 4,
      paddingHorizontal: spacing.md,
    },
    label: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      fontWeight: fontWeights.medium,
      color: colors.sageLight,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  })
