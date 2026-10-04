/**
 * components/setup-escrow-modal.tsx — Fund an escrow against a harvest batch
 *
 * Reached from the Provenance screen's empty state ("Set up escrow").
 * The buyer locks a USDC amount against the farm's newest batch for a
 * number of days:
 *
 *   - while the lock holds, the buyer can cancel and reclaim the funds;
 *   - once the farmer's terms complete, the farmer releases them.
 *
 * `useCreateEscrow` derives the escrow/vault PDAs from the batch and the
 * buyer's USDC ATA, so the form only collects amount + lock window. A guest
 * sees an honest "connect a wallet" note and a disabled submit.
 */

import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useCreateEscrow } from '@/features/escrow/useEscrow'
import { validateCreateEscrow, type EscrowValidationError } from '@/features/escrow/types'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

const EMPTY_ERRORS: EscrowValidationError = {}
const DAY_SECONDS = 86_400

interface SetupEscrowModalProps {
  /** The harvest batch the escrow attaches to (newest batch). */
  batchAddress: string
  /** Human label for the batch, e.g. "Sunflower · 640 kg". */
  batchLabel: string
  onClose: () => void
}

export function SetupEscrowModal({ batchAddress, batchLabel, onClose }: SetupEscrowModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const create = useCreateEscrow()
  const { walletState } = useMobileWalletSetup()
  const connected = walletState === 'connected'

  const [amount, setAmount] = useState('')
  const [lockDays, setLockDays] = useState('7')
  const [errors, setErrors] = useState<EscrowValidationError>(EMPTY_ERRORS)

  const busy = create.isPending
  const disabled = busy || !connected

  function submit() {
    if (disabled) return
    const days = Number.parseFloat(lockDays)
    const input = {
      batchAddress,
      amountUsdc: Number.parseFloat(amount),
      lockDurationSeconds: Math.round(days * DAY_SECONDS),
    }
    const found = validateCreateEscrow(input)
    setErrors(found ?? EMPTY_ERRORS)
    if (found) return

    create.mutate(input, { onSuccess: onClose })
  }

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Pad below the status bar (this Modal is statusBarTranslucent). */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.title}>{t('prov.escrow.title')}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>{t('prov.escrow.lead')}</Text>

          <Text style={styles.label}>{t('prov.escrow.batch')}</Text>
          <View style={styles.batchBox}>
            <Text style={styles.batchText} numberOfLines={1}>
              {batchLabel}
            </Text>
          </View>

          <Text style={styles.label}>{t('prov.escrow.amount')}</Text>
          <TextInput
            style={[styles.input, errors.amountUsdc ? styles.inputError : null]}
            value={amount}
            onChangeText={setAmount}
            placeholder="250"
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            keyboardType="decimal-pad"
            accessibilityLabel={t('prov.escrow.amount')}
          />
          {errors.amountUsdc ? <Text style={styles.fieldError}>{errors.amountUsdc}</Text> : null}

          <Text style={styles.label}>{t('prov.escrow.lockDays')}</Text>
          <TextInput
            style={[styles.input, errors.lockDurationSeconds ? styles.inputError : null]}
            value={lockDays}
            onChangeText={setLockDays}
            placeholder="7"
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            keyboardType="decimal-pad"
            accessibilityLabel={t('prov.escrow.lockDays')}
          />
          {errors.lockDurationSeconds ? (
            <Text style={styles.fieldError}>{errors.lockDurationSeconds}</Text>
          ) : (
            <Text style={styles.help}>{t('prov.escrow.lockHelp')}</Text>
          )}

          {!connected && (
            <View style={styles.note}>
              <Text style={styles.noteText}>{t('prov.escrow.walletNeeded')}</Text>
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
            testID="escrow-submit"
            accessibilityRole="button"
            accessibilityLabel={t('prov.escrow.submit')}
          >
            <Text style={styles.submitText}>{busy ? t('prov.escrow.submitting') : t('prov.escrow.submit')}</Text>
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
      marginTop: spacing.lg,
    },
    batchBox: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    batchText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.textSecondary,
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
