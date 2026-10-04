/**
 * components/underwrite-policy-modal.tsx — Buy parametric weather cover
 *
 * Reached from the Weather screen's empty state ("Underwrite policy").
 * Collects crop, coverage/premium amounts, the rainfall trigger (mm —
 * stored on-chain as mm × 10) and the season window (ISO dates → unix
 * seconds), then runs `create_policy` through `useCreatePolicy`.
 *
 * Policies live only on-chain, so a guest sees an honest "connect a
 * wallet" note and a disabled submit — no local fallback. On success the
 * provider's invalidation refetches the policy and the Weather screen
 * lights up.
 */

import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useCreatePolicy } from '@/features/insurance/useCreatePolicy'
import { validateCreatePolicy, type PolicyValidationError } from '@/features/insurance/types'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

const EMPTY_ERRORS: PolicyValidationError = {}

/** ISO date (YYYY-MM-DD) → unix seconds; unparseable input stays NaN so
 *  the season validator reports it. */
function dateToUnix(value: string): number {
  const parsed = Date.parse(value.trim())
  return Number.isNaN(parsed) ? Number.NaN : Math.floor(parsed / 1000)
}

interface UnderwritePolicyModalProps {
  farmAddress: string
  /** The farm's current policy count — the new policy takes this index. */
  policyCount: number
  onClose: () => void
}

export function UnderwritePolicyModal({ farmAddress, policyCount, onClose }: UnderwritePolicyModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const create = useCreatePolicy()
  const { walletState } = useMobileWalletSetup()
  const connected = walletState === 'connected'

  const [crop, setCrop] = useState('')
  const [coverage, setCoverage] = useState('')
  const [premium, setPremium] = useState('')
  const [thresholdMm, setThresholdMm] = useState('')
  const [seasonStart, setSeasonStart] = useState('')
  const [seasonEnd, setSeasonEnd] = useState('')
  const [errors, setErrors] = useState<PolicyValidationError>(EMPTY_ERRORS)

  const busy = create.isPending
  const disabled = busy || !connected

  function submit() {
    if (disabled) return
    const input = {
      farmAddress,
      policyCount,
      crop: crop.trim(),
      coverageUsdc: Number.parseFloat(coverage),
      premiumUsdc: Number.parseFloat(premium),
      // The program's unit is mm × 10 (500 = 50.0 mm).
      triggerThresholdMm: Math.round(Number.parseFloat(thresholdMm) * 10),
      seasonStart: dateToUnix(seasonStart),
      seasonEnd: dateToUnix(seasonEnd),
    }
    const found = validateCreatePolicy(input)
    setErrors(found ?? EMPTY_ERRORS)
    if (found) return

    create.mutate(input, { onSuccess: onClose })
  }

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Pad below the status bar (this Modal is statusBarTranslucent). */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.title}>{t('wx.policyForm.title')}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>{t('wx.policyForm.lead')}</Text>

          <Text style={styles.label}>{t('wx.policyForm.crop')}</Text>
          <TextInput
            style={[styles.input, errors.crop ? styles.inputError : null]}
            value={crop}
            onChangeText={setCrop}
            placeholder={t('wx.policyForm.phCrop')}
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            autoCapitalize="words"
            accessibilityLabel={t('wx.policyForm.crop')}
          />
          {errors.crop ? <Text style={styles.fieldError}>{errors.crop}</Text> : null}

          <View style={styles.moneyRow}>
            <View style={styles.moneyField}>
              <Text style={styles.label}>{t('wx.policyForm.coverage')}</Text>
              <TextInput
                style={[styles.input, errors.coverageUsdc ? styles.inputError : null]}
                value={coverage}
                onChangeText={setCoverage}
                placeholder="500"
                placeholderTextColor={colors.textDim}
                editable={!disabled}
                keyboardType="decimal-pad"
                accessibilityLabel={t('wx.policyForm.coverage')}
              />
              {errors.coverageUsdc ? <Text style={styles.fieldError}>{errors.coverageUsdc}</Text> : null}
            </View>
            <View style={styles.moneyField}>
              <Text style={styles.label}>{t('wx.policyForm.premium')}</Text>
              <TextInput
                style={[styles.input, errors.premiumUsdc ? styles.inputError : null]}
                value={premium}
                onChangeText={setPremium}
                placeholder="25"
                placeholderTextColor={colors.textDim}
                editable={!disabled}
                keyboardType="decimal-pad"
                accessibilityLabel={t('wx.policyForm.premium')}
              />
              {errors.premiumUsdc ? <Text style={styles.fieldError}>{errors.premiumUsdc}</Text> : null}
            </View>
          </View>

          <Text style={styles.label}>{t('wx.policyForm.threshold')}</Text>
          <TextInput
            style={[styles.input, errors.triggerThresholdMm ? styles.inputError : null]}
            value={thresholdMm}
            onChangeText={setThresholdMm}
            placeholder="50"
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            keyboardType="decimal-pad"
            accessibilityLabel={t('wx.policyForm.threshold')}
          />
          {errors.triggerThresholdMm ? (
            <Text style={styles.fieldError}>{errors.triggerThresholdMm}</Text>
          ) : (
            <Text style={styles.help}>{t('wx.policyForm.thresholdHelp')}</Text>
          )}

          <View style={styles.seasonRow}>
            <View style={styles.seasonField}>
              <Text style={styles.label}>{t('wx.policyForm.seasonStart')}</Text>
              <TextInput
                style={[styles.input, errors.season ? styles.inputError : null]}
                value={seasonStart}
                onChangeText={setSeasonStart}
                placeholder="2026-04-01"
                placeholderTextColor={colors.textDim}
                editable={!disabled}
                autoCapitalize="none"
                accessibilityLabel={t('wx.policyForm.seasonStart')}
              />
            </View>
            <View style={styles.seasonField}>
              <Text style={styles.label}>{t('wx.policyForm.seasonEnd')}</Text>
              <TextInput
                style={[styles.input, errors.season ? styles.inputError : null]}
                value={seasonEnd}
                onChangeText={setSeasonEnd}
                placeholder="2026-10-01"
                placeholderTextColor={colors.textDim}
                editable={!disabled}
                autoCapitalize="none"
                accessibilityLabel={t('wx.policyForm.seasonEnd')}
              />
            </View>
          </View>
          {errors.season ? <Text style={styles.fieldError}>{errors.season}</Text> : null}

          {!connected && (
            <View style={styles.note}>
              <Text style={styles.noteText}>{t('wx.policyForm.walletNeeded')}</Text>
            </View>
          )}

          {create.isError && create.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{create.error.message}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.submit, disabled && styles.submitBusy]}
            onPress={submit}
            disabled={disabled}
            testID="underwrite-submit"
            accessibilityRole="button"
            accessibilityLabel={t('wx.policyForm.submit')}
          >
            <Text style={styles.submitText}>{busy ? t('wx.policyForm.submitting') : t('wx.policyForm.submit')}</Text>
          </Pressable>

          <Pressable style={styles.cancel} onPress={onClose} disabled={busy} accessibilityRole="button">
            <Text style={styles.cancelText}>{t('scout.register.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textPrimary,
      fontSize: fontSizes.xl,
      lineHeight: 20,
    },
    body: {
      padding: spacing.lg,
      paddingBottom: spacing['3xl'],
    },
    lead: {
      fontSize: fontSizes.base,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.xl,
    },
    label: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md - 2,
      fontSize: fontSizes.base,
      color: colors.textPrimary,
    },
    inputError: {
      borderColor: colors.danger,
    },
    fieldError: {
      fontSize: fontSizes.xs,
      color: colors.dangerText,
      marginTop: 4,
      marginBottom: spacing.sm,
    },
    help: {
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginTop: 4,
      marginBottom: spacing.sm,
      lineHeight: 16,
    },
    moneyRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    moneyField: {
      flex: 1,
    },
    seasonRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    seasonField: {
      flex: 1,
    },
    note: {
      marginTop: spacing.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    noteText: {
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      lineHeight: 18,
    },
    errorBox: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    errorText: {
      fontSize: fontSizes.sm,
      color: colors.dangerText,
      lineHeight: 18,
    },
    submit: {
      marginTop: spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: radii.lg,
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    submitBusy: {
      opacity: 0.7,
    },
    submitText: {
      color: colors.surface,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
    },
    cancel: {
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    cancelText: {
      color: colors.textMuted,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
    },
  })
