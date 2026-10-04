/**
 * components/confirm-modal.tsx — Destructive-action confirmation sheet
 *
 * One shell shared by the three "are you sure?" flows: deleting a farm,
 * revoking a policy and erasing local account data. The caller passes the
 * honest copy (lead + consequence bullets) and an async `onConfirm` — the
 * modal runs it, surfaces its error inline, and closes on success.
 *
 * By default a connected wallet is required to confirm (the on-chain flows
 * need a signer); `requireWallet={false}` covers the device-local wipe,
 * which must also work for a guest.
 */

import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

interface ConfirmModalProps {
  title: string
  lead: string
  /** Honest consequences of proceeding — one line each. */
  bullets?: string[]
  confirmLabel: string
  busyLabel?: string
  /** Guest note shown above the actions when no wallet is connected. */
  walletNeeded?: string
  /** Require a connected wallet to confirm — default true. */
  requireWallet?: boolean
  /** Style the confirm button as destructive. */
  danger?: boolean
  testID?: string
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export function ConfirmModal({
  title,
  lead,
  bullets,
  confirmLabel,
  busyLabel,
  walletNeeded,
  requireWallet = true,
  danger = false,
  testID = 'confirm-submit',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const { walletState } = useMobileWalletSetup()
  const connected = walletState === 'connected'

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = busy || (requireWallet && !connected)

  async function confirm() {
    if (disabled) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Pad below the status bar (this Modal is statusBarTranslucent). */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.title}>{title}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>{lead}</Text>

          {bullets?.map((bullet) => (
            <View key={bullet} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>—</Text>
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}

          {requireWallet && !connected && walletNeeded ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>{walletNeeded}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.submit, danger && styles.submitDanger, disabled && styles.submitBusy]}
            onPress={confirm}
            disabled={disabled}
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
          >
            <Text style={styles.submitText}>{busy && busyLabel ? busyLabel : confirmLabel}</Text>
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
      flexShrink: 1,
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
      marginBottom: spacing.lg,
    },
    bulletRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    bulletDot: {
      fontSize: fontSizes.sm,
      color: colors.textDim,
    },
    bulletText: {
      flex: 1,
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      lineHeight: 18,
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
      borderColor: colors.borderMid,
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
    submitDanger: {
      backgroundColor: colors.danger,
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
