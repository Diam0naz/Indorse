/**
 * components/auth-provider.tsx — App lock for a registered user
 *
 * The keys live in the user's own wallet app (Mobile Wallet Adapter), so we
 * never touch key material here: this provider only gates *access to the app*,
 * the way a wallet app asks for its passcode or biometrics before showing
 * anything.
 *
 *   loading       → reading the stored verifier (blank gate, no flash of UI)
 *   unregistered  → first launch: no passcode set yet
 *   locked        → passcode set; returning to the foreground re-locks per
 *                   Settings → Wallet & Security → Auto-lock
 *   unlocked      → current session
 *
 * The verifier is a salted SHA-256 in expo-secure-store (Android Keystore
 * backs the file at rest) with a bounded attempt counter and a 30-second
 * cooldown after five wrong tries. Biometric unlock only short-circuits the
 * passcode after the *device* has authenticated the user.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { useSettings } from '@/components/settings-provider'
import { useT } from '@/lib/i18n'

const STORE_KEY = 'indorse.auth.v1'
const MAX_ATTEMPTS = 5
const COOLDOWN_MS = 30_000
/** Minimum passcode length — enforced by the register form. */
export const MIN_LENGTH = 6

export type AuthStatus = 'loading' | 'unregistered' | 'locked' | 'unlocked'

interface Verifier {
  salt: string
  hash: string
}

interface AuthValue {
  status: AuthStatus
  /** Device could ever unlock this way — fingerprint/face hardware present (or
   *  a credential already on file). Gates the *opt-in* on the register form:
   *  we offer it at sign-up time, before anything is enrolled. */
  biometricsSupported: boolean
  /** Device has fingerprint/face hardware *and* an enrolled credential, so a
   *  prompt can actually succeed. Gates auto-unlock on the lock screen. */
  biometricsAvailable: boolean
  /** Wrong tries left before the cooldown kicks in. */
  attemptsLeft: number
  /** Epoch ms until which attempts are refused; null when not cooling down. */
  cooldownEndsAt: number | null
  register: (passcode: string) => Promise<void>
  verify: (passcode: string) => Promise<boolean>
  unlockWithBiometrics: () => Promise<boolean>
  lock: () => void
  /** Forget the passcode entirely (Forgot passcode / change passcode). */
  reset: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

async function hashPasscode(passcode: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${passcode}`)
}

async function readVerifier(): Promise<Verifier | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Verifier>
    if (typeof parsed.salt === 'string' && typeof parsed.hash === 'string') {
      return { salt: parsed.salt, hash: parsed.hash }
    }
    return null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const t = useT()
  const { security } = useSettings()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [verifier, setVerifier] = useState<Verifier | null>(null)
  const [biometricsSupported, setBiometricsSupported] = useState(false)
  const [biometricsAvailable, setBiometricsAvailable] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS)
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null)

  // Boot: stored verifier?
  useEffect(() => {
    let active = true
    void readVerifier().then((stored) => {
      if (!active) return
      setVerifier(stored)
      setStatus(stored ? 'locked' : 'unregistered')
    })
    return () => {
      active = false
    }
  }, [])

  // Can we offer biometrics?
  useEffect(() => {
    void (async () => {
      try {
        const [hardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ])
        // Sign-up offers the opt-in as soon as the device *could* ever use it
        // (hardware present, or a credential already on file) — enrolment can
        // happen later, so an empty device must not hide the option.
        setBiometricsSupported(hardware || enrolled)
        setBiometricsAvailable(hardware && enrolled)
      } catch {
        setBiometricsSupported(false)
        setBiometricsAvailable(false)
      }
    })()
  }, [])

  // Auto-lock: leave the app → re-lock on return once the grace period passed.
  useEffect(() => {
    let backgroundedAt: number | null = null
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        if (backgroundedAt === null) backgroundedAt = Date.now()
        if (security.autoLock === 'immediate') setStatus((s) => (s === 'unlocked' ? 'locked' : s))
        return
      }
      if (next !== 'active' || backgroundedAt === null) return
      const elapsed = Date.now() - backgroundedAt
      backgroundedAt = null
      const graceMs =
        security.autoLock === 'never'
          ? Number.POSITIVE_INFINITY
          : security.autoLock === 'immediate'
            ? 0
            : Number(security.autoLock) * 60_000
      if (elapsed >= graceMs) setStatus((s) => (s === 'unlocked' ? 'locked' : s))
    }
    const subscription = AppState.addEventListener('change', onChange)
    return () => subscription.remove()
  }, [security.autoLock])

  const register = useCallback(async (passcode: string) => {
    const salt = Crypto.randomUUID()
    const hash = await hashPasscode(passcode, salt)
    const next: Verifier = { salt, hash }
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
    setVerifier(next)
    setAttemptsLeft(MAX_ATTEMPTS)
    setCooldownEndsAt(null)
    setStatus('unlocked')
  }, [])

  const verify = useCallback(
    async (passcode: string) => {
      if (!verifier) return false
      const now = Date.now()
      if (cooldownEndsAt !== null && now < cooldownEndsAt) return false

      const hash = await hashPasscode(passcode, verifier.salt)
      if (hash === verifier.hash) {
        setAttemptsLeft(MAX_ATTEMPTS)
        setCooldownEndsAt(null)
        setStatus('unlocked')
        return true
      }

      const left = attemptsLeft - 1
      setAttemptsLeft(left)
      if (left <= 0) {
        setCooldownEndsAt(now + COOLDOWN_MS)
        setAttemptsLeft(MAX_ATTEMPTS)
      }
      return false
    },
    [attemptsLeft, cooldownEndsAt, verifier],
  )

  const unlockWithBiometrics = useCallback(async () => {
    if (!biometricsAvailable) return false
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('auth.unlock.biometricPrompt'),
        cancelLabel: t('auth.unlock.passcode'),
      })
      if (result.success) {
        setStatus('unlocked')
        return true
      }
      return false
    } catch {
      return false
    }
  }, [biometricsAvailable, t])

  const lock = useCallback(() => setStatus((s) => (s === 'unlocked' ? 'locked' : s)), [])

  const reset = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined)
    setVerifier(null)
    setAttemptsLeft(MAX_ATTEMPTS)
    setCooldownEndsAt(null)
    setStatus('unregistered')
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      biometricsSupported,
      biometricsAvailable,
      attemptsLeft,
      cooldownEndsAt,
      register,
      verify,
      unlockWithBiometrics,
      lock,
      reset,
    }),
    [
      status,
      biometricsSupported,
      biometricsAvailable,
      attemptsLeft,
      cooldownEndsAt,
      register,
      verify,
      unlockWithBiometrics,
      lock,
      reset,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
