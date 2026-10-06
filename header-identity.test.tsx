/**
 * header-identity.test.tsx — The greeting addresses the real person
 *
 * The header used to show demo initials ("MH" — the fake operator in
 * constants/data) as everyone's avatar. The identity now follows a ladder:
 *
 *   - photo (not covered here — it needs an image source) →
 *   - real onboarding name → its initials, greeted by the full name
 *     ("Good morning, Sam Rivera");
 *   - connected wallet with no real name → the generated wallet label's
 *     initials in the avatar, the full label in the greeting;
 *   - neither → the line-drawn person icon and the connect prompt.
 *
 * The demo constant is asserted gone: no screen renders `USER.avatar`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react-native'
import { AppHeader } from '@/components/app-header'
import { initialsOf } from '@/lib/display-name'
import { walletName } from '@/lib/wallet-name'

const identity = vi.hoisted(() => ({
  walletState: 'disconnected' as string,
  address: null as string | null,
  profile: null as { name: string; bio?: string; photoUri?: string | null } | null,
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
  usePathname: () => '/(tabs)/index',
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: identity.walletState,
    address: identity.address,
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@/components/profile-provider', () => ({
  useProfile: () => ({ profile: identity.profile }),
}))

vi.mock('@/lib/skr', () => ({
  useSkrName: () => null,
}))

type Screen = Awaited<ReturnType<typeof render>>

async function renderHeader(): Promise<Screen> {
  return render(<AppHeader />)
}

beforeEach(() => {
  identity.walletState = 'disconnected'
  identity.address = null
  identity.profile = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('header identity — guest (no wallet, no name)', () => {
  it('shows the connect prompt and the person icon, never demo initials', async () => {
    const screen = await renderHeader()

    expect(screen.getByText('Connect your wallet')).toBeTruthy()
    expect(screen.getByTestId('headerAvatarIcon')).toBeTruthy()
    expect(screen.queryByText('MH')).toBeNull()
    expect(screen.queryByText('GW')).toBeNull()
  })
})

describe('header identity — wallet, no real name', () => {
  it('greets with the full generated label and initials its avatar', async () => {
    identity.walletState = 'connected'
    identity.address = 'Wallet111111111111111111111111111111111111'

    const screen = await renderHeader()

    const label = walletName(identity.address)
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText(initialsOf(label))).toBeTruthy()
    expect(screen.queryByText('MH')).toBeNull()
    expect(screen.queryByTestId('headerAvatarIcon')).toBeNull()
  })
})

describe('header identity — real onboarding name', () => {
  it('greets with the full name and the real initials (connected)', async () => {
    identity.walletState = 'connected'
    identity.address = 'Wallet111111111111111111111111111111111111'
    identity.profile = { name: 'Sam Rivera' }

    const screen = await renderHeader()

    expect(screen.getByText('Sam Rivera')).toBeTruthy()
    expect(screen.getByText('SR')).toBeTruthy()
    expect(screen.queryByText('MH')).toBeNull()
  })

  it('uses the real name even before a wallet is linked', async () => {
    identity.profile = { name: 'Sam Rivera' }

    const screen = await renderHeader()

    expect(screen.getByText('Sam Rivera')).toBeTruthy()
    expect(screen.getByText('SR')).toBeTruthy()
    expect(screen.queryByText('Connect your wallet')).toBeNull()
    expect(screen.queryByTestId('headerAvatarIcon')).toBeNull()
  })
})
