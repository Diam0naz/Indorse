/**
 * Device-verified mark (roadmap #5) — the Settings → Wallet & Security
 * section driven by the server verdict from `useDeviceVerification`.
 *
 * The wallet is mocked as connected and the hook's verdict is scripted per
 * test, so this covers exactly the UI mapping: which title/body shows for
 * each status and when the row offers (or stops offering) a verify action.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react-native'
import SecuritySettingsScreen from '@/app/settings/security'
import { AuthProvider } from '@/components/auth-provider'
import { SettingsProvider } from '@/components/settings-provider'

const mocks = vi.hoisted(() => ({
  status: 'idle' as string,
  reason: null as string | null,
  verify: vi.fn(),
  reset: vi.fn(),
  walletState: 'connected' as string,
  address: 'HollowTulipAddress111111111111111111111111' as string | null,
}))

vi.mock('@/features/wallet/useDeviceVerification', () => ({
  useDeviceVerification: () => ({
    status: mocks.status,
    reason: mocks.reason,
    verify: mocks.verify,
    reset: mocks.reset,
  }),
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: mocks.walletState,
    address: mocks.address,
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@react-native-clipboard/clipboard', () => ({
  default: { setString: vi.fn() },
}))

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
}))

vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status = 'idle'
  mocks.reason = null
  mocks.walletState = 'connected'
  mocks.address = 'HollowTulipAddress111111111111111111111111'
})

function renderScreen() {
  return render(
    <SettingsProvider>
      <AuthProvider>
        <SecuritySettingsScreen />
      </AuthProvider>
    </SettingsProvider>,
  )
}

describe('device verification section', () => {
  it('offers the verify action when idle', async () => {
    const screen = await renderScreen()

    expect(screen.getByText('Device verification')).toBeTruthy()
    const cta = screen.getByText('Verify this device')
    expect(screen.getByText(/prove wallet ownership/)).toBeTruthy()

    fireEvent.press(cta)
    expect(mocks.verify).toHaveBeenCalledTimes(1)
  })

  it('shows a busy, non-actionable row while verifying', async () => {
    mocks.status = 'verifying'
    const screen = await renderScreen()

    expect(screen.getByText('Verifying…')).toBeTruthy()

    fireEvent.press(screen.getByText('Verifying…'))
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('shows the verified mark with no action', async () => {
    mocks.status = 'verified'
    const screen = await renderScreen()

    expect(screen.getByText('✓ Device verified')).toBeTruthy()
    expect(screen.getByText(/development device allowlist/)).toBeTruthy()

    fireEvent.press(screen.getByText('✓ Device verified'))
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('shows the allowlist verdict when unverified and allows a re-check', async () => {
    mocks.status = 'unverified'
    mocks.reason = 'not-allowlisted'
    const screen = await renderScreen()

    expect(screen.getByText('Not on the allowlist yet')).toBeTruthy()
    expect(screen.getByText(/not listed on the server device allowlist/)).toBeTruthy()

    fireEvent.press(screen.getByText('Not on the allowlist yet'))
    expect(mocks.verify).toHaveBeenCalledTimes(1)
  })

  it('shows a retryable error state', async () => {
    mocks.status = 'error'
    const screen = await renderScreen()

    expect(screen.getByText('Verification failed — tap to try again.')).toBeTruthy()

    fireEvent.press(screen.getByText('Verification failed — tap to try again.'))
    expect(mocks.verify).toHaveBeenCalledTimes(1)
  })

  it('hides the section when the wallet is disconnected', async () => {
    mocks.walletState = 'disconnected'
    mocks.address = null
    const screen = await renderScreen()

    expect(screen.queryByText('Device verification')).toBeNull()
    expect(screen.queryByText('Verify this device')).toBeNull()
  })
})
