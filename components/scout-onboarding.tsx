/**
 * components/scout-onboarding.tsx — The scout tab's no-farm entry card
 *
 * Rendered instead of the scout dashboard while the operator has not added
 * any farm (no on-chain farm, nothing in the local registry). The docked
 * action pills hide with the dashboard — this card carries the primary CTA
 * for the current setup step instead:
 *
 *   1. Connect your wallet   → CTA connects the wallet
 *   2. Register your farm    → CTA opens the register-farm modal
 *   3. Add a field with GPS  → completes alongside step 2: the register
 *                              form requires name + GPS in one pass
 *
 * Scout now, anchor later: the info card at the bottom is a live "try a
 * scan" entry. The AI diagnosis needs no wallet and no farm, so scanning
 * works straight from this card — on-chain anchoring is what setup unlocks.
 * The screen keeps the capture as a local row (CameraOverlay's no-farm
 * path) and the card only renders before there is a farm to anchor against.
 *
 * Step state is derived, never stored: done → active → inactive as the
 * operator progresses, and the first unfinished step owns the CTA.
 */

import { Pressable, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { useTheme } from './theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useT, type MessageKey } from '@/lib/i18n'

type StepState = 'done' | 'active' | 'inactive'

export interface ScoutOnboardingProps {
  /** Wallet connected — completes step 1. */
  connected: boolean
  /** Farm registered (on-chain) — completes steps 2 and 3. */
  farmDone: boolean
  /** Step 1 CTA — connect or disconnect the wallet. */
  onConnect: () => void
  /** Steps 2–3 CTA — open the register-farm modal. */
  onRegister: () => void
  /** The info card — open the camera for a no-wallet diagnosis. */
  onScan: () => void
}

export function ScoutOnboarding({ connected, farmDone, onConnect, onRegister, onScan }: ScoutOnboardingProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const steps: { labelKey: MessageKey; state: StepState }[] = [
    { labelKey: 'scout.onboarding.step1', state: connected ? 'done' : 'active' },
    { labelKey: 'scout.onboarding.step2', state: farmDone ? 'done' : connected ? 'active' : 'inactive' },
    // The register form collects GPS with the farm, so step 3 never stands
    // alone while this card is on screen — it completes with step 2.
    { labelKey: 'scout.onboarding.step3', state: farmDone ? 'done' : 'inactive' },
  ]

  // The first unfinished step owns the CTA (all-done → the card is gone).
  const activeIndex = steps.findIndex((step) => step.state === 'active')
  const cta =
    activeIndex === 0
      ? { label: t('scout.onboarding.connect'), onPress: onConnect }
      : activeIndex > 0
        ? { label: t('scout.register.action'), onPress: onRegister }
        : null

  return (
    <View testID="scout-onboarding">
      <View style={styles.card}>
        <Text style={styles.title}>{t('scout.onboarding.title')}</Text>
        <Text style={styles.subtitle}>{t('scout.onboarding.subtitle')}</Text>

        <View style={styles.steps}>
          {steps.map((step, i) => {
            const isActive = step.state === 'active'
            const isDone = step.state === 'done'
            return (
              <View key={step.labelKey} style={styles.step}>
                <View style={[styles.stepDot, isActive && styles.stepDotActive, isDone && styles.stepDotDone]}>
                  {isDone ? (
                    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                      <Path
                        d="M3 7.4l2.6 2.6L11 4.4"
                        stroke={colors.sage}
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  ) : (
                    <Text style={[styles.stepNum, isActive && styles.stepNumActive]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[styles.stepText, isActive && styles.stepTextActive, isDone && styles.stepTextDone]}>
                  {t(step.labelKey)}
                </Text>
              </View>
            )
          })}
        </View>

        {cta ? (
          <Pressable style={styles.cta} onPress={cta.onPress} accessibilityRole="button" accessibilityLabel={cta.label}>
            <Text style={styles.ctaText}>{cta.label}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Live "try a scan" entry — the whole card is the button. */}
      <Pressable
        style={styles.info}
        onPress={onScan}
        accessibilityRole="button"
        accessibilityLabel={t('scout.fab')}
        testID="scout-onboarding-scan"
      >
        <View style={styles.infoIcon}>
          <Svg width={20} height={20} viewBox="0 0 14 14" fill="none">
            <Path
              d="M2 4.5C2 3.4 2.9 2.5 4 2.5h.5l1-1.5h3l1 1.5H10c1.1 0 2 .9 2 2v5c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-5z"
              stroke={colors.skyLight}
              strokeWidth={1.2}
            />
            <Circle cx={7} cy={7} r={1.8} stroke={colors.skyLight} strokeWidth={1.2} />
          </Svg>
        </View>
        <View style={styles.infoBody}>
          <Text style={styles.infoTitle}>{t('scout.onboarding.scanTitle')}</Text>
          <Text style={styles.infoDesc}>{t('scout.onboarding.scanBody')}</Text>
        </View>
        <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
          <Path
            d="M6 3.5L10.5 8L6 12.5"
            stroke={colors.textMuted}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
    </View>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    card: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing['2xl'],
    },
    title: {
      fontSize: fontSizes['3xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      letterSpacing: -0.4,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: fontSizes.lg,
      color: colors.textSecondary,
      marginBottom: spacing['3xl'],
    },
    steps: {
      gap: spacing.xl,
      marginBottom: spacing['3xl'],
    },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    stepDot: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDotActive: {
      backgroundColor: colors.amber,
      borderColor: colors.amber,
    },
    stepDotDone: {
      backgroundColor: colors.sageDim,
      borderColor: colors.sage,
    },
    stepNum: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.textMuted,
    },
    stepNumActive: {
      color: colors.surface,
    },
    stepText: {
      fontSize: fontSizes.xl,
      color: colors.textMuted,
    },
    stepTextActive: {
      color: colors.textPrimary,
      fontWeight: fontWeights.semibold,
    },
    stepTextDone: {
      color: colors.textPrimary,
    },
    cta: {
      backgroundColor: colors.amber,
      borderRadius: radii.full,
      paddingVertical: 16,
      alignItems: 'center',
    },
    ctaText: {
      color: colors.surface,
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
    },
    info: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      padding: spacing.xl,
      marginTop: spacing.lg,
    },
    infoIcon: {
      width: 44,
      height: 44,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.borderMid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoBody: {
      flex: 1,
      gap: 4,
    },
    infoTitle: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
    },
    infoDesc: {
      fontSize: fontSizes.lg,
      color: colors.textSecondary,
      lineHeight: 19,
    },
  })
