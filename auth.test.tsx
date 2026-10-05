/**
 * App lock tests (AuthProvider + AuthGate)
 *
 * The registered-user flow behaves like a wallet app: first launch sets a
 * passcode next to a hashed recovery email (with an optional emailed-code
 * step when an API is configured), every later return asks for it (or for
 * biometrics when the device and the preference allow — never the OS
 * credential screen), five wrong tries cool down, and "Forgot passcode?"
 * runs the email verification loop. The destructive wipe remains only for
 * legacy installs with no email on file — and it never touches wallet keys.
 * A session dormant for six months warns and signs back out.
 *
 * Native modules are mocked below (SecureStore, LocalAuthentication,
 * expo-crypto); settings and language fall back to their real providers.
 *
 * NOTE: every event is followed by an `await waitFor(...)`. Firing two
 * events back-to-back triggers React's "overlapping act() calls" warning
 * and leaves the renderer returning null trees for the rest of the file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Alert, Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { AuthGate } from '@/components/auth-gate'
import { AuthProvider, INACTIVITY_LIMIT_MS, isInactive, useAuth } from '@/components/auth-provider'
import { SettingsProvider } from '@/components/settings-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { LanguageProvider } from '@/lib/i18n'

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: vi.fn(async (key: string) => void store.delete(key)),
  }
})

// Deterministic salt + hash: hashPasscode(passcode, salt) === `sha256:${salt}:${passcode}`.
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: vi.fn(async (_alg: string, data: string) => `sha256:${data}`),
  randomUUID: vi.fn(() => 'salt-fixed'),
}))

vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: vi.fn(async () => true),
  isEnrolledAsync: vi.fn(async () => true),
  authenticateAsync: vi.fn(async () => ({ success: true })),
}))

const AUTH_KEY = 'indorse.auth.v1'
const LAST_ACTIVE_KEY = 'indorse.lastActive.v1'
const MAX_ATTEMPTS = 5

/** Mirrors the provider's stored shape for the mocked digest. */
async function seedVerifier(passcode = 'secret123') {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify({ salt: 'test-salt', hash: `sha256:test-salt:${passcode}` }))
}

/** The same, with a hashed recovery email on file (emailSalt → hashEmail). */
async function seedVerifierWithEmail(passcode = 'secret123', email = 'grower@example.com') {
  await SecureStore.setItemAsync(
    AUTH_KEY,
    JSON.stringify({
      salt: 'test-salt',
      hash: `sha256:test-salt:${passcode}`,
      emailSalt: 'email-salt',
      emailHash: `sha256:email-salt:${email}`,
      emailVerified: true,
    }),
  )
}

function Probe() {
  const { status } = useAuth()
  return <Text>{status}</Text>
}

type Utils = Awaited<ReturnType<typeof renderGate>>

async function renderGate() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <SettingsProvider>
          <AuthProvider>
            <Probe />
            <AuthGate />
          </AuthProvider>
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>,
  )
}

/** Type into a field, then wait for the controlled value to land. */
async function typeInto(utils: Utils, testID: string, text: string) {
  fireEvent.changeText(utils.getByTestId(testID), text)
  await waitFor(() => expect(utils.getByTestId(testID).props.value).toBe(text))
}

/** Stub fetch: /api/email/start answers `{sent}`, /api/email/verify `{verified}`. */
function stubEmailApi() {
  const mock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/start') ? { sent: true, expiresAt: 1 } : { verified: true }),
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

beforeEach(async () => {
  await AsyncStorage.clear()
  await SecureStore.deleteItemAsync(AUTH_KEY)
  vi.clearAllMocks()
  vi.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true)
  vi.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true)
  vi.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true })
  // A .env leak would switch the register form into its optional emailed-code
  // step; every test below decides for itself whether that step exists.
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
})

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
  vi.unstubAllGlobals()
})

describe('app lock', () => {
  it('asks a brand-new user to create a passcode and a recovery email', async () => {
    const utils = await renderGate()

    expect(await utils.findByText('Create your passcode')).toBeTruthy()
    // Submit stays disabled until the passcode AND the recovery email are in.
    expect(utils.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(true)

    await typeInto(utils, 'register-passcode', 'short')
    await typeInto(utils, 'register-confirm', 'short')
    await typeInto(utils, 'register-email', 'grower@example.com')
    expect(utils.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(true)

    await typeInto(utils, 'register-passcode', 'secret123')
    await typeInto(utils, 'register-confirm', 'secret123')
    // Passcodes are valid, but a plain-text-looking address must be checked.
    await typeInto(utils, 'register-email', 'not-an-email')
    expect(utils.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(true)

    await typeInto(utils, 'register-email', 'grower@example.com')
    expect(utils.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(false)
  })

  it('offers the biometric opt-in at sign-up even before anything is enrolled', async () => {
    // Hardware present, no fingerprint stored yet — the option must still show.
    vi.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false)

    const utils = await renderGate()
    await utils.findByText('Create your passcode')

    expect(await utils.findByText('Biometric unlock')).toBeTruthy()
    expect(await utils.findByText('Use Face ID or fingerprint instead of typing.')).toBeTruthy()
  })

  it('hides the biometric opt-in on a device without biometrics', async () => {
    vi.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(false)
    vi.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false)

    const utils = await renderGate()
    await utils.findByText('Create your passcode')
    await waitFor(() => expect(LocalAuthentication.isEnrolledAsync).toHaveBeenCalled())

    expect(utils.queryByText('Biometric unlock')).toBeNull()
  })

  it('stores the verifier (with the hashed email) and unlocks on registration', async () => {
    const utils = await renderGate()
    await utils.findByText('Create your passcode')

    await typeInto(utils, 'register-email', 'grower@example.com')
    await typeInto(utils, 'register-passcode', 'secret123')
    await typeInto(utils, 'register-confirm', 'secret123')
    fireEvent.press(utils.getByTestId('register-submit'))

    await waitFor(() => expect(utils.queryByText('Create your passcode')).toBeNull())
    expect(await SecureStore.getItemAsync(AUTH_KEY)).toContain('"salt":"salt-fixed"')

    // The address itself never lands on the device — only its salted hash.
    const stored = JSON.parse((await SecureStore.getItemAsync(AUTH_KEY))!) as Record<string, unknown>
    expect(stored.emailHash).toBe('sha256:salt-fixed:grower@example.com')
    expect(stored).not.toHaveProperty('email')
  })

  it('locks a returning user behind the passcode', async () => {
    await seedVerifier()
    const utils = await renderGate()

    expect(await utils.findByText('Welcome back')).toBeTruthy()
    expect(utils.getByText('locked')).toBeTruthy()

    await typeInto(utils, 'unlock-passcode', 'secret123')
    fireEvent.press(utils.getByTestId('unlock-submit'))

    await waitFor(() => expect(utils.getByText('unlocked')).toBeTruthy())
  })

  it('rejects a wrong passcode, counts the attempts down, then cools down', async () => {
    await seedVerifier()
    const utils = await renderGate()
    await utils.findByText('Welcome back')

    await typeInto(utils, 'unlock-passcode', 'nope-nope')
    fireEvent.press(utils.getByTestId('unlock-submit'))

    expect(await utils.findByText('That passcode is not correct.')).toBeTruthy()
    expect(await utils.findByText(`${MAX_ATTEMPTS - 1} attempts left before a cooldown.`)).toBeTruthy()

    // Burn the remaining attempts → cooldown replaces the attempt hint.
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      await typeInto(utils, 'unlock-passcode', 'nope-nope')
      fireEvent.press(utils.getByTestId('unlock-submit'))
      // verify() clears the field on every failure — that's the settle point.
      await waitFor(() => expect(utils.getByTestId('unlock-passcode').props.value).toBe(''))
    }

    expect(await utils.findByText('Try again in 30s.')).toBeTruthy()
    expect(utils.getByTestId('unlock-submit').props.accessibilityState?.disabled).toBe(true)
  })

  it('unlocks with biometrics when the device and preference allow it', async () => {
    await seedVerifier()
    await AsyncStorage.setItem('indorse.settings', JSON.stringify({ security: { biometrics: true } }))

    const utils = await renderGate()

    // The prompt can resolve before the title is even queried, so assert the outcome.
    await waitFor(() => expect(utils.getByText('unlocked')).toBeTruthy())
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled()
    // The OS credential fallback — where "reset your device password" lives —
    // must never be handed the prompt.
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: true }),
    )
  })

  it('falls back to the passcode when biometrics are not enabled', async () => {
    await seedVerifier()
    const utils = await renderGate()
    await utils.findByText('Welcome back')

    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled()
    expect(utils.getByText('locked')).toBeTruthy()
  })

  it('forgets only the app lock on "Forgot passcode?"', async () => {
    await seedVerifier()
    const utils = await renderGate()
    await utils.findByText('Welcome back')

    // The wipe is confirmed first — drive the destructive action from the alert.
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.()
    })

    fireEvent.press(utils.getByLabelText('Forgot passcode?'))

    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(await utils.findByText('Create your passcode')).toBeTruthy()
    expect(utils.getByText('unregistered')).toBeTruthy()
    await waitFor(() => expect(SecureStore.getItemAsync(AUTH_KEY)).resolves.toBeNull())
    alertSpy.mockRestore()
  })

  it('sends password loss through the email verification loop when an email is on file', async () => {
    await seedVerifierWithEmail()
    process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = 'https://api.test'
    const fetchMock = stubEmailApi()
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined)

    const utils = await renderGate()
    await utils.findByText('Welcome back')

    fireEvent.press(utils.getByLabelText('Forgot passcode?'))

    // No destructive alert — the loop opens instead.
    await utils.findByTestId('recover-email')
    expect(alertSpy).not.toHaveBeenCalled()

    // A wrong address is refused locally, before anything is emailed.
    await typeInto(utils, 'recover-email', 'stranger@example.com')
    fireEvent.press(utils.getByTestId('recover-send'))
    expect(await utils.findByText('That is not the recovery email on this device.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    // The address on file → code → inbox proof → new passcode → unlocked.
    await typeInto(utils, 'recover-email', 'grower@example.com')
    fireEvent.press(utils.getByTestId('recover-send'))
    await utils.findByTestId('recover-code')

    await typeInto(utils, 'recover-code', '123456')
    fireEvent.press(utils.getByTestId('recover-submit'))
    await utils.findByTestId('recover-passcode')

    await typeInto(utils, 'recover-passcode', 'newsecret')
    await typeInto(utils, 'recover-confirm', 'newsecret')
    fireEvent.press(utils.getByTestId('recover-finish'))

    await waitFor(() => expect(utils.getByText('unlocked')).toBeTruthy())
    // The recovery email survives the reset — still hashed, now freshly proven.
    const stored = JSON.parse((await SecureStore.getItemAsync(AUTH_KEY))!) as Record<string, unknown>
    expect(stored.hash).toBe('sha256:salt-fixed:newsecret')
    expect(stored.emailHash).toBe('sha256:salt-fixed:grower@example.com')
    expect(stored.emailVerified).toBe(true)

    alertSpy.mockRestore()
  })

  it('confirms the emailed code during sign-up when the API is configured', async () => {
    process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = 'https://api.test'
    const fetchMock = stubEmailApi()

    const utils = await renderGate()
    await utils.findByText('Create your passcode')

    await typeInto(utils, 'register-email', 'grower@example.com')
    await typeInto(utils, 'register-passcode', 'secret123')
    await typeInto(utils, 'register-confirm', 'secret123')
    fireEvent.press(utils.getByTestId('register-submit'))

    // Entering the step auto-sends the first code.
    await utils.findByTestId('register-code')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await typeInto(utils, 'register-code', '123456')
    fireEvent.press(utils.getByTestId('register-verify'))

    await waitFor(() => expect(utils.getByText('unlocked')).toBeTruthy())
    const stored = JSON.parse((await SecureStore.getItemAsync(AUTH_KEY))!) as Record<string, unknown>
    expect(stored.emailVerified).toBe(true)
    expect(stored.emailHash).toBe('sha256:salt-fixed:grower@example.com')
  })

  it('lets a sign-up skip the code step — the email stays on file, unverified', async () => {
    process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = 'https://api.test'
    stubEmailApi()

    const utils = await renderGate()
    await utils.findByText('Create your passcode')

    await typeInto(utils, 'register-email', 'grower@example.com')
    await typeInto(utils, 'register-passcode', 'secret123')
    await typeInto(utils, 'register-confirm', 'secret123')
    fireEvent.press(utils.getByTestId('register-submit'))

    await utils.findByTestId('register-code')
    fireEvent.press(utils.getByLabelText('Skip for now'))

    await waitFor(() => expect(utils.getByText('unlocked')).toBeTruthy())
    const stored = JSON.parse((await SecureStore.getItemAsync(AUTH_KEY))!) as Record<string, unknown>
    expect(stored.emailVerified).toBe(false)
    expect(stored.emailHash).toBe('sha256:salt-fixed:grower@example.com')
  })

  it('warns and signs out a session dormant for six months — the passcode still works', async () => {
    await seedVerifier()
    await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now() - INACTIVITY_LIMIT_MS - 60_000))
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined)

    const utils = await renderGate()

    expect(await utils.findByText('Welcome back')).toBeTruthy()
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Signed out for inactivity', expect.any(String), expect.any(Array)),
    )
    expect(utils.getByText('locked')).toBeTruthy()

    // It is a sign-out, not a wipe: wallet-adjacent data and the passcode
    // are untouched, so they can walk right back in.
    await typeInto(utils, 'unlock-passcode', 'secret123')
    fireEvent.press(utils.getByTestId('unlock-submit'))
    await waitFor(() => expect(utils.getByText('unlocked')).toBeTruthy())

    alertSpy.mockRestore()
  })
})

describe('isInactive', () => {
  it('only trips once six months have passed', () => {
    const now = 1_700_000_000_000
    expect(isInactive(null, now)).toBe(false)
    expect(isInactive(now, now)).toBe(false)
    expect(isInactive(now - INACTIVITY_LIMIT_MS + 1, now)).toBe(false)
    expect(isInactive(now - INACTIVITY_LIMIT_MS, now)).toBe(true)
    expect(isInactive(now - INACTIVITY_LIMIT_MS - 1, now)).toBe(true)
  })
})
