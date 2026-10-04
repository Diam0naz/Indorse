/**
 * components/auth-gate.tsx — The lock screen over the whole app
 *
 * Rendered once by the root layout. While `status !== 'unlocked'` it covers
 * the navigator with a full-screen modal, so route state (onboarding, tabs,
 * settings) survives a lock and there is no flash of app content on launch —
 * during `loading` the gate is an empty field-coloured screen.
 *
 * First launch shows the register form (passcode + the biometric opt-in when
 * the device can offer biometrics, enrolled or not), later returns show the
 * unlock form (biometric prompt first when enabled, password fallback with
 * attempts + cooldown).
 */

import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import { useSettings } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { MIN_LENGTH, useAuth } from '@/components/auth-provider'
import { fontSizes, fontWeights, radii, spacing, createStyles, type Colors } from '@/constants/theme'
import { requestEmailCode, verifyEmailCode } from '@/features/email/emailApi'
import { getVerifiedEmail, type VerifiedEmailRecord } from '@/features/email/verifiedEmailStore'
import { useT } from '@/lib/i18n'

const COOLDOWN_TICK_MS = 1000

export function AuthGate() {
  const { status } = useAuth()
  const { colors } = useTheme()
  const styles = makeStyles(colors)

  return (
    <Modal visible={status !== 'unlocked'} animationType="none" statusBarTranslucent>
      <View style={styles.root}>
        {status === 'unregistered' ? <RegisterForm /> : status === 'locked' ? <UnlockForm /> : null}
      </View>
    </Modal>
  )
}

/* ── Shared field ────────────────────────────────────────────────────────── */

interface FieldProps {
  label: string
  value: string
  onChangeText: (text: string) => void
  onSubmit?: () => void
  error?: boolean
  autoFocus?: boolean
  testID?: string
}

function PasscodeField({ label, value, onChangeText, onSubmit, error, autoFocus, testID }: FieldProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const [hidden, setHidden] = useState(true)

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error && styles.inputWrapError]}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          secureTextEntry={hidden}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          placeholder="••••••"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          accessibilityLabel={label}
        />
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.reveal}>{hidden ? 'Show' : 'Hide'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  testID,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  testID?: string
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <Pressable
      testID={testID}
      onPress={disabled || busy ? undefined : onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={({ pressed }) => [
        styles.primary,
        pressed && !disabled && !busy && styles.primaryPressed,
        (disabled || busy) && styles.primaryDisabled,
      ]}
    >
      <View style={styles.primaryContent}>
        {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        <Text style={styles.primaryLabel}>{label}</Text>
      </View>
    </Pressable>
  )
}

/* ── Register ────────────────────────────────────────────────────────────── */

function RegisterForm() {
  const t = useT()
  const { colors } = useTheme()
  const { register, biometricsSupported } = useAuth()
  const { security, setSecurity } = useSettings()
  const styles = makeStyles(colors)

  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tooShort = passcode.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && confirm !== passcode
  const canSubmit = !tooShort && confirm.length > 0 && !mismatch && !busy

  async function submit() {
    if (!canSubmit) {
      setError(tooShort ? t('auth.create.hint') : mismatch ? t('auth.create.mismatch') : null)
      return
    }
    setBusy(true)
    try {
      await register(passcode)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('auth.create.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.create.subtitle')}</Text>

      <PasscodeField
        label={t('auth.create.passcode')}
        value={passcode}
        onChangeText={(text) => {
          setPasscode(text)
          setError(null)
        }}
        onSubmit={() => confirm.length > 0 && void submit()}
        error={error === t('auth.create.hint')}
        autoFocus
        testID="register-passcode"
      />
      <PasscodeField
        label={t('auth.create.confirm')}
        value={confirm}
        onChangeText={(text) => {
          setConfirm(text)
          setError(null)
        }}
        onSubmit={() => void submit()}
        error={mismatch}
        testID="register-confirm"
      />

      {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.hint}>{t('auth.create.hint')}</Text>}

      {biometricsSupported ? (
        <View style={styles.biometricRow}>
          <View style={styles.biometricText}>
            <Text style={styles.biometricTitle}>{t('auth.create.biometricsTitle')}</Text>
            <Text style={styles.biometricBody}>{t('auth.create.biometricsBody')}</Text>
          </View>
          <Switch
            value={security.biometrics}
            onValueChange={(biometrics) => setSecurity({ biometrics })}
            accessibilityLabel={t('auth.create.biometricsTitle')}
            trackColor={{ true: colors.primary, false: colors.borderMid }}
            thumbColor={colors.white}
          />
        </View>
      ) : null}

      <PrimaryButton
        label={t('auth.create.cta')}
        onPress={() => void submit()}
        disabled={!canSubmit}
        busy={busy}
        testID="register-submit"
      />
    </ScrollView>
  )
}

/* ── Unlock ──────────────────────────────────────────────────────────────── */

function UnlockForm() {
  const t = useT()
  const { colors } = useTheme()
  const { verify, unlockWithBiometrics, reset, attemptsLeft, cooldownEndsAt, biometricsAvailable } = useAuth()
  const { security } = useSettings()
  const styles = makeStyles(colors)

  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [recovering, setRecovering] = useState(false)
  const triedBiometrics = useRef(false)

  const cooling = cooldownEndsAt !== null && cooldownEndsAt > now
  const cooldownSeconds = cooling ? Math.max(0, Math.ceil((cooldownEndsAt! - now) / 1000)) : 0

  // Tick while cooling so the countdown actually counts down.
  useEffect(() => {
    if (!cooling) return
    const id = setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS)
    return () => clearInterval(id)
  }, [cooling])

  // First move on return: try the device biometrics when they are enabled.
  useEffect(() => {
    if (triedBiometrics.current || !security.biometrics || !biometricsAvailable) return
    triedBiometrics.current = true
    void unlockWithBiometrics()
  }, [security.biometrics, biometricsAvailable, unlockWithBiometrics])

  async function submit() {
    if (cooling || busy) return
    setBusy(true)
    try {
      const ok = await verify(passcode)
      if (!ok) {
        setError(t('auth.unlock.error'))
        setPasscode('')
        setNow(Date.now())
      }
    } finally {
      setBusy(false)
    }
  }

  /** Wipes the stored verifier — async (SecureStore), so show the same busy state. */
  async function performForgot() {
    setBusy(true)
    try {
      await reset()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Confirm first — this is an irreversible local wipe with no recovery step,
   * so it matches the Security screen's confirm-then-act pattern.
   */
  function forgot() {
    if (busy) return
    Alert.alert(t('auth.unlock.forgotConfirm'), t('auth.unlock.forgotConfirmBody'), [
      { text: t('security.cancel'), style: 'cancel' },
      { text: t('auth.unlock.forgotConfirmCta'), style: 'destructive', onPress: () => void performForgot() },
    ])
  }

  // Email recovery is a full-screen alternative to the passcode form.
  if (recovering) return <RecoverForm onBack={() => setRecovering(false)} />

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('auth.unlock.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.unlock.subtitle')}</Text>

      <PasscodeField
        label={t('auth.unlock.passcode')}
        value={passcode}
        onChangeText={(text) => {
          setPasscode(text)
          setError(null)
        }}
        onSubmit={() => void submit()}
        error={error !== null}
        autoFocus={!security.biometrics}
        testID="unlock-passcode"
      />

      {error ? (
        <Text style={styles.error}>{cooling ? t('auth.unlock.cooldown', { s: cooldownSeconds }) : error}</Text>
      ) : null}
      {error && !cooling && attemptsLeft < 5 ? (
        <Text style={styles.hint}>{t('auth.unlock.attempts', { n: attemptsLeft })}</Text>
      ) : null}

      <PrimaryButton
        label={t('auth.unlock.cta')}
        onPress={() => void submit()}
        disabled={passcode.length === 0 || cooling}
        busy={busy}
        testID="unlock-submit"
      />

      <Pressable
        onPress={forgot}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('auth.unlock.forgot')}
        style={styles.forgot}
        hitSlop={8}
      >
        <Text style={styles.forgotLabel}>{t('auth.unlock.forgot')}</Text>
      </Pressable>

      <Pressable
        onPress={() => setRecovering(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('auth.unlock.recover')}
        style={styles.forgot}
        hitSlop={8}
      >
        <Text style={styles.forgotLabel}>{t('auth.unlock.recover')}</Text>
      </Pressable>
    </ScrollView>
  )
}

/* ── Recover (email) ─────────────────────────────────────────────────────── */

function RecoverForm({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { colors } = useTheme()
  const { reset } = useAuth()
  const styles = makeStyles(colors)

  // undefined = still loading the remembered pair; null = none on this device.
  const [saved, setSaved] = useState<VerifiedEmailRecord | null | undefined>(undefined)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getVerifiedEmail()
      .then((record) => {
        if (!cancelled) setSaved(record)
      })
      .catch(() => {
        if (!cancelled) setSaved(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Email a code. No wallet session is needed — the pair was proven earlier. */
  async function send() {
    if (!saved || busy) return
    setBusy(true)
    setError(null)
    try {
      await requestEmailCode(saved.email, saved.wallet)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.unlock.recoverSend'))
    } finally {
      setBusy(false)
    }
  }

  /** Confirm the code, then wipe the passcode — the gate drops into register. */
  async function confirm() {
    if (!saved || busy) return
    setBusy(true)
    setError(null)
    try {
      await verifyEmailCode(saved.email, saved.wallet, code.trim())
      await reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.unlock.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('auth.unlock.recoverTitle')}</Text>

      {saved === undefined ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : saved === null ? (
        <Text style={styles.subtitle}>{t('auth.unlock.recoverNone')}</Text>
      ) : (
        <>
          <Text style={styles.subtitle}>{t('auth.unlock.recoverLead', { email: saved.email })}</Text>

          {sent ? (
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="123456"
                placeholderTextColor={colors.textDim}
                accessibilityLabel={t('email.code')}
                testID="recover-code"
              />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {sent ? (
            <PrimaryButton
              label={busy ? t('email.verifying') : t('auth.unlock.recoverConfirm')}
              onPress={() => void confirm()}
              disabled={code.trim().length === 0}
              busy={busy}
              testID="recover-submit"
            />
          ) : (
            <PrimaryButton
              label={busy ? t('email.sending') : t('auth.unlock.recoverSend')}
              onPress={() => void send()}
              busy={busy}
              testID="recover-send"
            />
          )}
        </>
      )}

      <Pressable
        onPress={onBack}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('auth.unlock.recoverBack')}
        style={styles.forgot}
        hitSlop={8}
      >
        <Text style={styles.forgotLabel}>{t('auth.unlock.recoverBack')}</Text>
      </Pressable>
    </ScrollView>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
      justifyContent: 'center',
    },
    content: {
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing['3xl'],
      gap: spacing.md,
      // Fill the screen so the form sits vertically centred when it fits, and
      // scrolls normally from the top when it does not (long register form,
      // open keyboard).
      flexGrow: 1,
      justifyContent: 'center',
    },
    title: {
      fontSize: fontSizes['4xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: fontSizes.md,
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    field: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: fontSizes.xs,
      fontWeight: fontWeights.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: colors.textMuted,
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
    },
    inputWrapError: {
      borderColor: colors.danger,
    },
    input: {
      flex: 1,
      paddingVertical: spacing.md,
      fontSize: fontSizes.xl,
      color: colors.textPrimary,
    },
    reveal: {
      fontSize: fontSizes.xs,
      fontWeight: fontWeights.semibold,
      color: colors.primary,
    },
    hint: {
      fontSize: fontSizes.xs,
      color: colors.textMuted,
    },
    error: {
      fontSize: fontSizes.xs,
      color: colors.dangerText,
    },
    biometricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
      marginTop: spacing.sm,
    },
    biometricText: {
      flex: 1,
      gap: spacing.xs,
    },
    biometricTitle: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
    },
    biometricBody: {
      fontSize: fontSizes.xs,
      color: colors.textSecondary,
    },
    primary: {
      marginTop: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.primary,
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    primaryPressed: {
      backgroundColor: colors.primaryHover,
    },
    primaryDisabled: {
      backgroundColor: colors.surfaceAlt,
    },
    primaryContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    primaryLabel: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
      color: colors.background,
    },
    forgot: {
      alignSelf: 'center',
      marginTop: spacing.lg,
      padding: spacing.sm,
    },
    forgotLabel: {
      fontSize: fontSizes.sm,
      color: colors.textSecondary,
      textDecorationLine: 'underline',
    },
  })
