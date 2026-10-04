/**
 * components/verify-email-modal.tsx — confirm an email for the connected wallet
 *
 * Reached from Settings → Wallet & Security. Two steps: send a 6-digit code to
 * the address, then enter it. The code is bound to the connected wallet, and on
 * success the (email, wallet) pair is remembered on device so the app lock can
 * offer email recovery later.
 *
 * All decisions live on the server (`api/email/*`); this modal only collects the
 * two inputs and renders the busy / sent / verified states.
 */

import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useEmailVerification } from '@/features/email/useEmailVerification'
import { saveVerifiedEmail } from '@/features/email/verifiedEmailStore'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

interface VerifyEmailModalProps {
  onClose: () => void
  /** Called with the confirmed address after a successful verification. */
  onVerified?: (email: string) => void
}

export function VerifyEmailModal({ onClose, onVerified }: VerifyEmailModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const { walletState, address: walletAddress } = useMobileWalletSetup()
  const connected = walletState === 'connected'

  const { status, email, error, verified, sendCode, confirmCode } = useEmailVerification()
  const [emailInput, setEmailInput] = useState('')
  const [code, setCode] = useState('')

  const sending = status === 'sending'
  const verifying = status === 'verifying'
  const sent = status === 'sent' || verifying || verified
  const busy = sending || verifying

  useEffect(() => {
    if (!verified || !email || !walletAddress) return
    void saveVerifiedEmail(email, walletAddress)
    onVerified?.(email)
  }, [verified, email, walletAddress, onVerified])

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Pad below the status bar (this Modal is statusBarTranslucent). */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.title}>{t('email.title')}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>{t('email.lead')}</Text>

          {verified ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{t('email.verified')}</Text>
              <Text style={styles.successEmail} numberOfLines={1}>
                {email}
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>{t('email.address')}</Text>
              <TextInput
                style={styles.input}
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder={t('email.placeholder')}
                placeholderTextColor={colors.textDim}
                editable={!busy && !sent}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel={t('email.address')}
              />

              {sent ? (
                <>
                  {email ? <Text style={styles.help}>{t('email.sent', { email })}</Text> : null}
                  <Text style={styles.label}>{t('email.code')}</Text>
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={setCode}
                    placeholder="123456"
                    placeholderTextColor={colors.textDim}
                    editable={!busy}
                    keyboardType="number-pad"
                    maxLength={6}
                    accessibilityLabel={t('email.code')}
                  />
                </>
              ) : null}
            </>
          )}

          {!connected && !verified ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>{t('email.walletNeeded')}</Text>
            </View>
          ) : null}

          {error && !verified ? <Text style={styles.errorText}>{error}</Text> : null}

          {verified ? (
            <Pressable
              style={styles.submit}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('email.done')}
            >
              <Text style={styles.submitText}>{t('email.done')}</Text>
            </Pressable>
          ) : sent ? (
            <>
              <Pressable
                style={[styles.submit, (busy || !connected) && styles.submitBusy]}
                onPress={() => void confirmCode(code)}
                disabled={busy || !connected || code.trim().length === 0}
                accessibilityRole="button"
                accessibilityLabel={t('email.confirm')}
              >
                <Text style={styles.submitText}>{verifying ? t('email.verifying') : t('email.confirm')}</Text>
              </Pressable>
              <Pressable
                style={styles.resend}
                onPress={() => void sendCode(emailInput)}
                disabled={busy || !connected}
                accessibilityRole="button"
              >
                <Text style={styles.resendText}>{t('email.resend')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.submit, (busy || !connected) && styles.submitBusy]}
              onPress={() => void sendCode(emailInput)}
              disabled={busy || !connected}
              accessibilityRole="button"
              accessibilityLabel={t('email.send')}
            >
              <Text style={styles.submitText}>{sending ? t('email.sending') : t('email.send')}</Text>
            </Pressable>
          )}

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
    root: { flex: 1, backgroundColor: colors.background },
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
    title: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.textPrimary },
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
    closeText: { color: colors.textPrimary, fontSize: fontSizes.xl, lineHeight: 20 },
    body: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
    lead: { fontSize: fontSizes.base, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xl },
    label: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 6,
      marginTop: spacing.lg,
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
    help: { fontSize: fontSizes.xs, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
    successBox: {
      borderWidth: 1,
      borderColor: `${colors.sage}66`,
      backgroundColor: `${colors.sage}14`,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: 4,
    },
    successText: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.sageLight },
    successEmail: { fontFamily: 'monospace', fontSize: fontSizes.sm, color: colors.textSecondary },
    note: {
      marginTop: spacing.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    noteText: { fontSize: fontSizes.sm, color: colors.textMuted, lineHeight: 18 },
    errorText: { fontSize: fontSizes.sm, color: colors.dangerText, marginTop: spacing.md, lineHeight: 18 },
    submit: {
      marginTop: spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: radii.lg,
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    submitBusy: { opacity: 0.7 },
    submitText: { color: colors.surface, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
    resend: { marginTop: spacing.md, paddingVertical: spacing.sm, alignItems: 'center' },
    resendText: { color: colors.sky, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
    cancel: { marginTop: spacing.md, paddingVertical: spacing.md, alignItems: 'center' },
    cancelText: { color: colors.textMuted, fontSize: fontSizes.md, fontWeight: fontWeights.semibold },
  })
