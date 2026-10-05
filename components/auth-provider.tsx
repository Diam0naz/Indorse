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
 * cooldown after five wrong tries. Next to it sits the recovery email, hashed
 * the same way (its own salt, never the address itself), so a forgotten
 * passcode can be recovered by proving control of that inbox — see
 * `matchRecoveryEmail` and the gate's email loop.
 *
 * Biometric unlock only short-circuits the passcode after the *device* has
 * authenticated the user, and it never hands off to the OS credential screen:
 * `disableDeviceFallback` keeps Android's "forgot password → reset your
 * device password" surface out of this app entirely. Finally, a session idle
 * for six months (`INACTIVITY_LIMIT_MS`) is warned about and signed back out —
 * wallet keys are never involved.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { Alert, AppState, type AppStateStatus } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { useSettings } from '@/components/settings-provider'
import { useT } from '@/lib/i18n'

const STORE_KEY = 'indorse.auth.v1'
const LAST_ACTIVE_KEY = 'indorse.lastActive.v1'
const MAX_ATTEMPTS = 5
const COOLDOWN_MS = 30_000
/** Minimum passcode length — enforced by the register form. */
export const MIN_LENGTH = 6
/** Six months of silence, and the next open signs the session out again. */
export const INACTIVITY_LIMIT_MS = 180 * 24 * 60 * 60 * 1000

export type AuthStatus = 'loading' | 'unregistered' | 'locked' | 'unlocked'

interface Verifier {
  salt: string
  hash: string
  /** Salted SHA-256 of the recovery email — the address is never stored. */
  emailSalt?: string
  emailHash?: string
  /** True once a code emailed to that address has actually been proven. */
  emailVerified?: boolean
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
  /** A hashed recovery email is on file — gates the email reset loop. */
  recoveryEmailOnFile: boolean
  /** The on-file recovery email was proven by a code at least once. */
  recoveryEmailVerified: boolean
  register: (passcode: string, email?: string, emailVerified?: boolean) => Promise<void>
  verify: (passcode: string) => Promise<boolean>
  unlockWithBiometrics: () => Promise<boolean>
  lock: () => void
  /** Forget the passcode entirely (change passcode / no-email fallback). */
  reset: () => Promise<void>
  /** Does this typed address hash to the one on file? Gates the reset send. */
  matchRecoveryEmail: (email: string) => Promise<boolean>
  /** Hash a proven address onto the verifier (register, Settings verify). */
  setRecoveryEmail: (email: string, emailVerified?: boolean) => Promise<void>
  /** Replace the passcode after an email-proven recovery; keeps the email. */
  resetPasscode: (passcode: string, provenEmail?: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Lower-cased and trimmed, mirroring `api/_lib/otp-store.ts`. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Deliberately loose — deliverability is the provider's job, not a regex battle. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

/** Has this app been untouched for six months? `null` = never opened yet. */
export function isInactive(lastActiveAt: number | null, now = Date.now()): boolean {
  return lastActiveAt !== null && now - lastActiveAt >= INACTIVITY_LIMIT_MS
}

async function hashPasscode(passcode: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${passcode}`)
}

/** Same construction as the passcode hash, over the normalized address. */
async function hashEmail(email: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${normalizeEmail(email)}`)
}

async function readVerifier(): Promise<Verifier | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Verifier>
    if (typeof parsed.salt === 'string' && typeof parsed.hash === 'string') {
      const hasEmail = typeof parsed.emailSalt === 'string' && typeof parsed.emailHash === 'string'
      return {
        salt: parsed.salt,
        hash: parsed.hash,
        ...(hasEmail
          ? { emailSalt: parsed.emailSalt, emailHash: parsed.emailHash, emailVerified: parsed.emailVerified === true }
          : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

async function readLastActive(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ACTIVE_KEY)
    const parsed = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : null
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
  const lastActiveRef = useRef<number | null>(null)

  /** Remember "the app was used just now" — feeds the six-month check. */
  const touchLastActive = useCallback(() => {
    const now = Date.now()
    lastActiveRef.current = now
    void AsyncStorage.setItem(LAST_ACTIVE_KEY, String(now)).catch(() => undefined)
  }, [])

  const warnInactive = useCallback(() => {
    Alert.alert(t('auth.inactive.title'), t('auth.inactive.body'), [{ text: t('auth.inactive.ok') }])
  }, [t])

  // Boot: stored verifier? Still dormant?
  useEffect(() => {
    let active = true
    void Promise.all([readVerifier(), readLastActive()]).then(([stored, lastActive]) => {
      if (!active) return
      lastActiveRef.current = lastActive
      setVerifier(stored)
      setStatus(stored ? 'locked' : 'unregistered')
      // Six months away: warn, then leave them at the lock screen (auto-lock
      // preferences never keep a dormant session alive).
      if (stored && isInactive(lastActive)) warnInactive()
      touchLastActive()
    })
    return () => {
      active = false
    }
  }, [touchLastActive, warnInactive])

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
      // Dormancy beats every auto-lock grace, including "never": a session
      // idle for six months is warned about and signed straight out.
      const dormant = isInactive(lastActiveRef.current)
      touchLastActive()
      if (dormant) {
        setStatus((s) => (s === 'unlocked' ? 'locked' : s))
        warnInactive()
        return
      }
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
  }, [security.autoLock, touchLastActive, warnInactive])

  const register = useCallback(
    async (passcode: string, email?: string, emailVerified?: boolean) => {
      const salt = Crypto.randomUUID()
      const hash = await hashPasscode(passcode, salt)
      const next: Verifier = { salt, hash }
      if (email && isValidEmail(email)) {
        const emailSalt = Crypto.randomUUID()
        next.emailSalt = emailSalt
        next.emailHash = await hashEmail(email, emailSalt)
        next.emailVerified = emailVerified === true
      }
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
      setVerifier(next)
      setAttemptsLeft(MAX_ATTEMPTS)
      setCooldownEndsAt(null)
      setStatus('unlocked')
      touchLastActive()
    },
    [touchLastActive],
  )

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
        touchLastActive()
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
    [attemptsLeft, cooldownEndsAt, verifier, touchLastActive],
  )

  const unlockWithBiometrics = useCallback(async () => {
    if (!biometricsAvailable) return false
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('auth.unlock.biometricPrompt'),
        cancelLabel: t('auth.unlock.passcode'),
        // No OS credential fallback: Android's device-credential screen is
        // where "reset your device password" lives, and that question has no
        // answer inside this app. Failed biometrics simply fall back to the
        // passcode field below.
        disableDeviceFallback: true,
      })
      if (result.success) {
        setStatus('unlocked')
        touchLastActive()
        return true
      }
      return false
    } catch {
      return false
    }
  }, [biometricsAvailable, t, touchLastActive])

  const lock = useCallback(() => setStatus((s) => (s === 'unlocked' ? 'locked' : s)), [])

  const reset = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined)
    setVerifier(null)
    setAttemptsLeft(MAX_ATTEMPTS)
    setCooldownEndsAt(null)
    setStatus('unregistered')
  }, [])

  const matchRecoveryEmail = useCallback(
    async (email: string) => {
      if (!verifier?.emailSalt || !verifier.emailHash) return false
      if (!isValidEmail(email)) return false
      return (await hashEmail(email, verifier.emailSalt)) === verifier.emailHash
    },
    [verifier],
  )

  const setRecoveryEmail = useCallback(
    async (email: string, emailVerified = true) => {
      if (!verifier || !isValidEmail(email)) return
      const emailSalt = Crypto.randomUUID()
      const next: Verifier = {
        ...verifier,
        emailSalt,
        emailHash: await hashEmail(email, emailSalt),
        emailVerified,
      }
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
      setVerifier(next)
    },
    [verifier],
  )

  /**
   * The recovery outcome: a new passcode with the recovery email kept (or a
   * freshly proven one hashed on), straight through to an unlocked session —
   * no detour through a wipe.
   */
  const resetPasscode = useCallback(
    async (passcode: string, provenEmail?: string) => {
      const salt = Crypto.randomUUID()
      const hash = await hashPasscode(passcode, salt)
      const next: Verifier = { salt, hash }
      if (provenEmail !== undefined && isValidEmail(provenEmail)) {
        const emailSalt = Crypto.randomUUID()
        next.emailSalt = emailSalt
        next.emailHash = await hashEmail(provenEmail, emailSalt)
        next.emailVerified = true
      } else if (verifier?.emailSalt && verifier.emailHash) {
        next.emailSalt = verifier.emailSalt
        next.emailHash = verifier.emailHash
        next.emailVerified = verifier.emailVerified === true
      }
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
      setVerifier(next)
      setAttemptsLeft(MAX_ATTEMPTS)
      setCooldownEndsAt(null)
      setStatus('unlocked')
      touchLastActive()
    },
    [verifier, touchLastActive],
  )

  const value = useMemo<AuthValue>(
    () => ({
      status,
      biometricsSupported,
      biometricsAvailable,
      attemptsLeft,
      cooldownEndsAt,
      recoveryEmailOnFile: verifier?.emailHash !== undefined,
      recoveryEmailVerified: verifier?.emailVerified === true,
      register,
      verify,
      unlockWithBiometrics,
      lock,
      reset,
      matchRecoveryEmail,
      setRecoveryEmail,
      resetPasscode,
    }),
    [
      status,
      biometricsSupported,
      biometricsAvailable,
      attemptsLeft,
      cooldownEndsAt,
      verifier,
      register,
      verify,
      unlockWithBiometrics,
      lock,
      reset,
      matchRecoveryEmail,
      setRecoveryEmail,
      resetPasscode,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
