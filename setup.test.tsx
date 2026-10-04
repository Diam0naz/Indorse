/**
 * app/setup.tsx tests — Profile-driven setup wizard
 *
 * The wizard is exercised end-to-end through its own step machine:
 *   step 1 validation gate → advance → photo option sheet → Skip-for-now
 *   walk through steps 2–5 → the final checklist → "Start scouting →".
 *
 * Steps 2–5 mount only while active, so their collaborators (wallet, farm
 * query, auth, location, the register modal) are stubbed at the module
 * boundary — the wizard owns navigation and deferral, those own their data.
 * ProfileProvider is mounted for the full walk so a saved profile and four
 * persisted deferrals are what the checklist actually reports.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import SetupScreen from '@/app/setup'
import { ProfileProvider } from '@/components/profile-provider'

const { copyAsync, routerReplace } = vi.hoisted(() => ({
  copyAsync: vi.fn(async () => undefined),
  routerReplace: vi.fn(),
}))

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
}))

vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: routerReplace, back: vi.fn() },
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn() }),
  usePathname: () => '/setup',
}))

// The wizard only ever *requests* permissions and launches pickers; the test
// drives the library path (a granted permission and one picked photo).
vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchCameraAsync: vi.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cache/pic.jpg' }] })),
}))

// persistPhoto copies the picked photo into documentDirectory/profile/.
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/doc/',
  makeDirectoryAsync: vi.fn(async () => undefined),
  deleteAsync: vi.fn(async () => undefined),
  copyAsync,
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: 'disconnected',
    address: null,
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({ farm: null, farmAddress: null, state: 'ready', retry: vi.fn() }),
}))

// LockStep reads the passcode status; AuthGate (not the wizard) owns the flow.
vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ status: 'unregistered' }),
}))

// Permission checks are read-only here — deterministic "not granted" in tests.
vi.mock('@/features/scout/location', () => ({
  getLocationPermission: vi.fn(async () => false),
  requestLocationPermission: vi.fn(async () => false),
}))

// The modal pulls the mobile-wallet provider through its mutation hooks.
vi.mock('@/components/register-farm-modal', async () => {
  const { Text } = await import('react-native')
  return { RegisterFarmModal: () => <Text testID="register-farm-modal">Register your farm</Text> }
})

/** Simulated reads resolve quickly; give each assertion room. */
const LOAD = { timeout: 3000 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setup wizard', () => {
  it('gates step 1 on a display name, then advances', async () => {
    const screen = await render(<SetupScreen />)

    expect(screen.getByText('Step 1 of 6')).toBeTruthy()
    expect(screen.getByText('Your profile')).toBeTruthy()
    expect(screen.getByText('About you (optional)')).toBeTruthy()

    // Empty name → the validator's English error, no advance.
    await fireEvent.press(screen.getByText('Next'))
    expect(screen.getByTestId('setup-name-error').props.children).toBe('Name is required')
    expect(screen.getByText('Step 1 of 6')).toBeTruthy()

    // Editing clears the error; a valid name moves on.
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mae Hollenbeck'), 'Amina Otieno')
    expect(screen.queryByTestId('setup-name-error')).toBeNull()
    await fireEvent.press(screen.getByText('Next'))
    await screen.findByText('Step 2 of 6', {}, LOAD)
    expect(screen.getByText('Connect your wallet')).toBeTruthy()
  })

  it('opens the photo option sheet and applies a library pick', async () => {
    const screen = await render(<SetupScreen />)

    await fireEvent.press(screen.getByLabelText('Profile photo'))
    await screen.findByText('Choose from library', {}, LOAD)
    expect(screen.getByText('Take a photo')).toBeTruthy()
    expect(screen.queryByText('Remove photo')).toBeNull() // nothing to remove yet

    await fireEvent.press(screen.getByText('Choose from library'))

    // The cache URI was copied into documentDirectory/profile/ and rendered.
    // (RN normalizes Image source into an array.)
    await waitFor(() =>
      expect(screen.getByTestId('setup-photo-img').props.source).toEqual([{ uri: '/doc/profile/avatar.jpg' }]),
    )
    expect(copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/pic.jpg',
      to: '/doc/profile/avatar.jpg',
    })
  })

  it('offers camera and location grants on the access step', async () => {
    const screen = await render(<SetupScreen />)

    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mae Hollenbeck'), 'Amina Otieno')
    await fireEvent.press(screen.getByText('Next'))
    await screen.findByText('Step 2 of 6', {}, LOAD)
    await fireEvent.press(screen.getByText('Skip for now'))
    await screen.findByText('Step 3 of 6', {}, LOAD)
    await fireEvent.press(screen.getByText('Skip for now'))

    await screen.findByText('Step 4 of 6', {}, LOAD)
    expect(screen.getByText('Camera')).toBeTruthy()
    expect(screen.getByText('Location')).toBeTruthy()
    // The location check resolves to "not granted" a tick later.
    await waitFor(() => expect(screen.getAllByText('Not allowed').length).toBe(2))

    await fireEvent.press(screen.getByLabelText('Allow Camera'))
    expect(screen.getAllByText('Not allowed').length).toBe(2)
  })

  it('walks the remaining steps with Skip and finishes on Start scouting', async () => {
    const screen = await render(
      <ProfileProvider>
        <SetupScreen />
      </ProfileProvider>,
    )

    // Step 1 → 2 (the saved profile feeds the final checklist).
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mae Hollenbeck'), 'Amina Otieno')
    await fireEvent.press(screen.getByText('Next'))

    // Steps 2 → 5: each Skip persists its deferral.
    await screen.findByText('Step 2 of 6', {}, LOAD)
    await fireEvent.press(screen.getByText('Skip for now'))
    await screen.findByText('Step 3 of 6', {}, LOAD)
    expect(screen.getByText('Register your farm')).toBeTruthy()
    await fireEvent.press(screen.getByText('Skip for now'))
    await screen.findByText('Step 4 of 6', {}, LOAD)
    await fireEvent.press(screen.getByText('Skip for now'))
    await screen.findByText('Step 5 of 6', {}, LOAD)
    expect(screen.getByText('Protect the app')).toBeTruthy()
    expect(screen.getByText('Open security settings')).toBeTruthy()
    await fireEvent.press(screen.getByText('Skip for now'))

    // Step 6 — profile saved + three deferrals ⇒ every signal handled.
    await screen.findByText('Step 6 of 6', {}, LOAD)
    expect(screen.getByText("You're all set")).toBeTruthy()
    expect(screen.getByText('Profile saved')).toBeTruthy()
    expect(screen.getByText('Wallet connected')).toBeTruthy()
    expect(screen.getByText('Farm registered')).toBeTruthy()
    expect(screen.getByText('Access granted')).toBeTruthy()
    expect(screen.queryByText('Pending')).toBeNull()

    await fireEvent.press(screen.getByText('Start scouting'))
    expect(routerReplace).toHaveBeenCalledWith('/(tabs)')
  })
})
