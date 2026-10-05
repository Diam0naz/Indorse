/**
 * components/auth-gate.tsx — The lock screen over the whole app
 *
 * Rendered once by the root layout. While `status !== 'unlocked'` it covers
 * the navigator with a full-screen modal, so route state (onboarding, tabs,
 * settings) survives a lock and there is no flash of app content on launch —
 * during `loading` the gate is an empty field-coloured screen.
 *
 * First launch shows the register form (recovery email + passcode + the
 * biometric opt-in when the device can offer biometrics, enrolled or not);
 * with an API configured, an optional emailed-code step confirms the address
 * before the account exists. Later returns show the unlock form (biometric
 * prompt first when enabled, passcode fallback with attempts + cooldown).
 *
 * "Forgot passcode?" is the password-loss path: when any recovery email is on
 * file it opens the email verification loop (prove the inbox, choose a new
 * passcode — the wallet is never involved). The destructive local wipe is the
 * legacy fallback for installs that never saved an email.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import { useSettings } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { MIN_LENGTH, isValidEmail, normalizeEmail, useAuth } from '@/components/auth-provider'
import { fontSizes, fontWeights, radii, spacing, createStyles, type Colors } from '@/constants/theme'
import { isEmailEndpointConfigured, requestEmailCode, verifyEmailCode } from '@/features/email/emailApi'
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

/* ── Shared fields ───────────────────────────────────────────────────────── */

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

function EmailField({ label, value, onChangeText, onSubmit, error, autoFocus, testID }: FieldProps) {
  const t = useT()
  const { colors } = useTheme()
  const styles = makeStyles(colors)

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error && styles.inputWrapError]}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          placeholder={t('email.placeholder')}
          placeholderTextColor={colors.textDim}
          style={styles.input}
          accessibilityLabel={label}
        />
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

  const [phase, setPhase] = useState<'details' | 'verify'>('details')
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const autoSent = useRef(false)

  const tooShort = passcode.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && confirm !== passcode
  const emailOk = isValidEmail(email)
  const canSubmit = !tooShort && confirm.length > 0 && !mismatch && emailOk && !busy

  /** Step 1 → 2. With an API configured, confirm the email before the lock. */
  async function submitDetails() {
    if (!canSubmit) {
      setError(
        tooShort
          ? t('auth.create.hint')
          : mismatch
            ? t('auth.create.mismatch')
            : !emailOk
              ? t('auth.create.emailInvalid')
              : null,
      )
      return
    }
    if (!isEmailEndpointConfigured()) {
      setBusy(true)
      try {
        await register(passcode, email)
      } finally {
        setBusy(false)
      }
      return
    }
    setPhase('verify')
  }

  const sendCode = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await requestEmailCode(email)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.create.emailSendError'))
    } finally {
      setBusy(false)
    }
  }, [email, t])

  // Entering step 2: send the first code straight away. The user can resend
  // or skip — the passcode they just typed is still in state either way.
  useEffect(() => {
    if (phase !== 'verify' || autoSent.current) return
    autoSent.current = true
    void sendCode()
  }, [phase, sendCode])

  const verifyCode = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await verifyEmailCode(email, undefined, code.trim())
      await register(passcode, email, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.code.error'))
    } finally {
      setBusy(false)
    }
  }, [code, email, passcode, register, t])

  const skip = useCallback(() => {
    void register(passcode, email)
  }, [passcode, email, register])

  if (phase === 'verify') {
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('email.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.create.verifyLead', { email })}</Text>

        {sent ? (
          <View style={styles.inputWrap}>
            <TextInput
              testID="register-code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
              placeholderTextColor={colors.textDim}
              accessibilityLabel={t('email.code')}
              style={styles.input}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {sent ? (
          <>
            <PrimaryButton
              label={busy ? t('email.verifying') : t('email.confirm')}
              onPress={() => void verifyCode()}
              disabled={code.trim().length === 0}
              busy={busy}
              testID="register-verify"
            />
            <Pressable
              onPress={() => void sendCode()}
              disabled={busy}
              accessibilityRole="button"
              style={styles.forgot}
              hitSlop={8}
            >
              <Text style={styles.forgotLabel}>{t('email.resend')}</Text>
            </Pressable>
          </>
        ) : (
          <PrimaryButton
            label={busy ? t('email.sending') : t('email.send')}
            onPress={() => void sendCode()}
            busy={busy}
            testID="register-send"
          />
        )}

        <Pressable
          onPress={skip}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('auth.create.skip')}
          style={styles.forgot}
          hitSlop={8}
        >
          <Text style={styles.forgotLabel}>{t('auth.create.skip')}</Text>
        </Pressable>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('auth.create.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.create.subtitle')}</Text>

      <EmailField
        label={t('auth.create.email')}
        value={email}
        onChangeText={(text) => {
          setEmail(text)
          setError(null)
        }}
        onSubmit={() => void submitDetails()}
        error={error === t('auth.create.emailInvalid')}
        testID="register-email"
      />
      <Text style={styles.hint}>{t('auth.create.emailHint')}</Text>

      <PasscodeField
        label={t('auth.create.passcode')}
        value={passcode}
        onChangeText={(text) => {
          setPasscode(text)
          setError(null)
        }}
        onSubmit={() => confirm.length > 0 && void submitDetails()}
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
        onSubmit={() => void submitDetails()}
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
        onPress={() => void submitDetails()}
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
  const {
    verify,
    unlockWithBiometrics,
    reset,
    attemptsLeft,
    cooldownEndsAt,
    biometricsAvailable,
    recoveryEmailOnFile,
  } = useAuth()
  const { security } = useSettings()
  const styles = makeStyles(colors)

  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [recovering, setRecovering] = useState(false)
  // undefined = still loading the remembered Settings pair; null = none.
  const [savedPair, setSavedPair] = useState<VerifiedEmailRecord | null | undefined>(undefined)
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

  useEffect(() => {
    let cancelled = false
    getVerifiedEmail()
      .then((record) => {
        if (!cancelled) setSavedPair(record ?? null)
      })
      .catch(() => {
        if (!cancelled) setSavedPair(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
   * Password loss goes to the email loop whenever any recovery email exists —
   * the hashed one from sign-up, or a pair proven in Settings. Only legacy
   * installs without either get the irreversible local wipe, confirmed first
   * so it matches the Security screen's confirm-then-act pattern.
   */
  function forgot() {
    if (busy) return
    if (recoveryEmailOnFile || savedPair) {
      setRecovering(true)
      return
    }
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
    </ScrollView>
  )
}

/* ── Recover (email verification loop) ───────────────────────────────────── */

type RecoverStep = 'request' | 'code' | 'newPasscode'

function RecoverForm({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { colors } = useTheme()
  const { resetPasscode, matchRecoveryEmail, recoveryEmailOnFile } = useAuth()
  const styles = makeStyles(colors)

  // undefined = still loading the remembered pair; null = none on this device.
  const [saved, setSaved] = useState<VerifiedEmailRecord | null | undefined>(undefined)
  const [step, setStep] = useState<RecoverStep>('request')
  const [emailInput, setEmailInput] = useState('')
  const [targetEmail, setTargetEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPasscode, setNewPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
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

  // The hashed sign-up email is the primary source (retyped and hash-checked
  // here); a pair proven in Settings is the fallback for accounts that
  // predate it. undefined = still resolving the fallback.
  const source: 'hash' | 'pair' | null | undefined = recoveryEmailOnFile
    ? 'hash'
    : saved === undefined
      ? undefined
      : saved
        ? 'pair'
        : null

  /** Step 1: prove which address, then email a code to it. */
  async function send() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      let next: string
      if (source === 'hash') {
        // Gate the send on a local hash match — the app never emails an
        // address that is not the one already on file.
        if (!(await matchRecoveryEmail(emailInput))) {
          setError(t('auth.unlock.recoverMismatch'))
          return
        }
        next = normalizeEmail(emailInput)
        await requestEmailCode(next)
      } else if (source === 'pair' && saved) {
        next = saved.email
        await requestEmailCode(next, saved.wallet)
      } else {
        return
      }
      setTargetEmail(next)
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.create.emailSendError'))
    } finally {
      setBusy(false)
    }
  }

  /** Step 2: check the code back — inbox control, wallet or not. */
  async function submitCode() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await verifyEmailCode(targetEmail, source === 'pair' && saved ? saved.wallet : undefined, code.trim())
      setStep('newPasscode')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.code.error'))
    } finally {
      setBusy(false)
    }
  }

  /** Step 3: new passcode, same account — the recovery email stays on file. */
  async function finish() {
    if (busy) return
    if (newPasscode.length < MIN_LENGTH) {
      setError(t('auth.create.hint'))
      return
    }
    if (confirmPasscode !== newPasscode) {
      setError(t('auth.create.mismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await resetPasscode(newPasscode, targetEmail)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.unlock.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>
        {step === 'newPasscode' ? t('auth.unlock.newPasscode') : t('auth.unlock.recoverTitle')}
      </Text>

      {source === undefined ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : source === null ? (
        <Text style={styles.subtitle}>{t('auth.unlock.recoverNone')}</Text>
      ) : step === 'request' ? (
        <>
          {source === 'pair' && saved ? (
            <Text style={styles.subtitle}>{t('auth.unlock.recoverLead', { email: saved.email })}</Text>
          ) : (
            <>
              <Text style={styles.subtitle}>{t('auth.unlock.recoverEmailLead')}</Text>
              <EmailField
                label={t('auth.unlock.recoverEmailLabel')}
                value={emailInput}
                onChangeText={(text) => {
                  setEmailInput(text)
                  setError(null)
                }}
                onSubmit={() => void send()}
                error={error === t('auth.unlock.recoverMismatch')}
                testID="recover-email"
              />
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton
            label={busy ? t('email.sending') : t('auth.unlock.recoverSend')}
            onPress={() => void send()}
            disabled={source === 'hash' && !isValidEmail(emailInput)}
            busy={busy}
            testID="recover-send"
          />
        </>
      ) : step === 'code' ? (
        <>
          <Text style={styles.subtitle}>{t('email.sent', { email: targetEmail })}</Text>

          <View style={styles.inputWrap}>
            <TextInput
              testID="recover-code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
              placeholderTextColor={colors.textDim}
              accessibilityLabel={t('email.code')}
              style={styles.input}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton
            label={busy ? t('email.verifying') : t('email.confirm')}
            onPress={() => void submitCode()}
            disabled={code.trim().length === 0}
            busy={busy}
            testID="recover-submit"
          />

          <Pressable
            onPress={() => void send()}
            disabled={busy}
            accessibilityRole="button"
            style={styles.forgot}
            hitSlop={8}
          >
            <Text style={styles.forgotLabel}>{t('email.resend')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>{t('auth.unlock.newPasscodeLead')}</Text>

          <PasscodeField
            label={t('auth.create.passcode')}
            value={newPasscode}
            onChangeText={(text) => {
              setNewPasscode(text)
              setError(null)
            }}
            onSubmit={() => confirmPasscode.length > 0 && void finish()}
            error={error === t('auth.create.hint')}
            autoFocus
            testID="recover-passcode"
          />
          <PasscodeField
            label={t('auth.create.confirm')}
            value={confirmPasscode}
            onChangeText={(text) => {
              setConfirmPasscode(text)
              setError(null)
            }}
            onSubmit={() => void finish()}
            error={confirmPasscode.length > 0 && confirmPasscode !== newPasscode}
            testID="recover-confirm"
          />

          {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.hint}>{t('auth.create.hint')}</Text>}

          <PrimaryButton
            label={t('auth.unlock.newPasscodeCta')}
            onPress={() => void finish()}
            disabled={newPasscode.length === 0 || confirmPasscode.length === 0}
            busy={busy}
            testID="recover-finish"
          />
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
