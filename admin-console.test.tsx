/**
 * Admin console — gating + the deliberate-confirmation flow.
 *
 * Two surfaces share one gate: the Settings entry on the profile renders
 * only for `config.admin`, and the console screen itself re-checks the same
 * value so a deep link lands on a locked screen instead of the operator
 * surface. Both are UX — the program re-verifies the role on every gated
 * instruction — so the security-relevant behaviour to lock down is the
 * confirmation flow: value-moving actions must not fire from one tap, and
 * the typed phrase is what arms them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ed25519 } from '@noble/curves/ed25519.js'
import { getBase58Decoder } from '@solana/kit'
import type { ReactElement } from 'react'
import { router } from 'expo-router'
import ProfileScreen from '@/app/(tabs)/rewards'
import AdminSettingsScreen from '@/app/settings/admin'

/* ── Scenario state shared by the mock factories ──────────────────────────── */

const scenario = vi.hoisted(() => ({
  address: null as string | null,
  configAdmin: null as string | null,
  farm: null as Record<string, unknown> | null,
  policy: null as Record<string, unknown> | null,
  reading: null as Record<string, unknown> | null,
  balance: null as number | null,
  sendTxs: vi.fn(),
}))

/* ── Native/expo mocks (mirrors settings.test.tsx) ────────────────────────── */

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

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: { signIn: vi.fn() },
    walletState: scenario.address ? 'connected' : 'disconnected',
    address: scenario.address,
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@wallet-ui/react-native-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wallet-ui/react-native-kit')>()
  return {
    ...actual,
    useMobileWallet: () => ({
      account: scenario.address ? { address: scenario.address } : null,
      sendTransactions: scenario.sendTxs,
    }),
  }
})

vi.mock('@/features/wallet/useWalletBalances', () => ({
  useWalletBalances: () => ({ balances: { sol: 4.218, usdc: 1842.5 }, loading: false }),
}))

vi.mock('@/lib/skr', () => ({ useSkrName: () => null }))

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({
    farm: scenario.farm,
    farmAddress: scenario.farm?.address ?? null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/reports/useReportsQuery', () => ({
  useReportsQuery: () => ({ reports: [], state: 'ready' as const, retry: vi.fn() }),
}))

vi.mock('@/features/escrow/useEscrowQuery', () => ({
  useEscrowQuery: () => ({
    escrow: null,
    escrowAddress: null,
    batchAddress: null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/usePolicyQuery', () => ({
  usePolicyQuery: () => ({
    policy: scenario.policy,
    policyAddress: scenario.policy?.address ?? null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/useWeatherOracleQuery', () => ({
  useWeatherOracleQuery: () => ({ reading: scenario.reading, state: 'ready' as const, retry: vi.fn() }),
}))

/* ── Admin feature mocks — chain reads never leave the process ────────────── */

vi.mock('@/features/admin/useConfigQuery', () => ({
  useConfigQuery: () => ({
    config: scenario.configAdmin
      ? {
          admin: scenario.configAdmin,
          verifier: 'VerifierRole1111111111111111111111111111111',
          oracle: 'OracleRole11111111111111111111111111111111',
          bump: 255,
        }
      : null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/admin/useVerifierSetQuery', () => ({
  useVerifierSetQuery: () => ({ set: null, state: 'ready' as const, retry: vi.fn() }),
}))

vi.mock('@/features/admin/useOracleSetQuery', () => ({
  useOracleSetQuery: () => ({ set: null, state: 'ready' as const, retry: vi.fn() }),
}))

vi.mock('@/features/admin/useUsdcBalanceQuery', () => ({
  useUsdcBalanceQuery: () => ({ balance: scenario.balance, state: 'ready' as const, retry: vi.fn() }),
}))

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

function freshAddress(): string {
  return getBase58Decoder().decode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))
}

const ADMIN_ADDR = freshAddress()
const OTHER_ADDR = freshAddress()
const FARM_ADDR = freshAddress()
const FARMER_ADDR = freshAddress()
const POLICY_ADDR = freshAddress()

const SEASON_START = 1_748_736_000 // 2025-06-01 — season long over "now"
const SEASON_END = 1_759_276_800 // 2025-09-30

const ACTIVE_ENDED_POLICY = {
  address: POLICY_ADDR,
  farm: FARM_ADDR,
  farmer: FARMER_ADDR,
  index: 0,
  crop: 'Maize',
  coverageUsdc: 10_000_000, // $10 coverage (e6)
  premiumUsdc: 500_000,
  triggerThresholdMm: 500, // 50 mm
  seasonStart: SEASON_START,
  seasonEnd: SEASON_END,
  verifiedReportsAtCreation: 0,
  state: 'active',
  bump: 255,
}

const FINALIZED_READING = {
  farm: FARM_ADDR,
  seasonStart: SEASON_START,
  totalRainfallMm: 300, // 30 mm < 50 mm → trigger fires
  readingTimestamp: SEASON_END,
  finalized: true,
  readings: [],
  bump: 255,
}

const PENDING_READING = { ...FINALIZED_READING, totalRainfallMm: 0, finalized: false }

const FARM = {
  address: FARM_ADDR,
  name: 'Green Valley',
  owner: FARMER_ADDR,
  latE6: 46_882_100,
  lngE6: -98_702_300,
  reportCount: 0,
  batchCount: 0,
  policyCount: 1,
  bump: 255,
}

function renderScreen(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  scenario.sendTxs.mockReset()
  scenario.sendTxs.mockResolvedValue(undefined)
  scenario.address = ADMIN_ADDR
  scenario.configAdmin = ADMIN_ADDR
  scenario.farm = null
  scenario.policy = null
  scenario.reading = null
  scenario.balance = null
})

/* ── Settings menu gating ─────────────────────────────────────────────────── */

describe('settings menu gating', () => {
  it('hides the admin entry when the wallet is not config.admin', async () => {
    scenario.address = OTHER_ADDR
    scenario.configAdmin = ADMIN_ADDR

    const screen = await renderScreen(<ProfileScreen />)
    expect(await screen.findByText('Wallet & Security')).toBeTruthy()
    expect(screen.queryByText('Admin Console')).toBeNull()
  })

  it('shows the admin entry for config.admin and routes into the console', async () => {
    scenario.address = ADMIN_ADDR
    scenario.configAdmin = ADMIN_ADDR

    const screen = await renderScreen(<ProfileScreen />)
    await fireEvent.press(await screen.findByText('Admin Console'))
    expect(router.push).toHaveBeenCalledWith('/settings/admin')
  })
})

/* ── Screen gating ────────────────────────────────────────────────────────── */

describe('console gating', () => {
  it('locks the screen for a deep link from a non-admin wallet', async () => {
    scenario.address = OTHER_ADDR
    scenario.configAdmin = ADMIN_ADDR

    const screen = await renderScreen(<AdminSettingsScreen />)
    expect(await screen.findByText(/only for the wallet stored as config\.admin/)).toBeTruthy()
    expect(screen.queryByText('Withdraw')).toBeNull()
    expect(screen.queryByText('API ADMIN')).toBeNull()
  })

  it('renders the full operator surface for config.admin', async () => {
    const screen = await renderScreen(<AdminSettingsScreen />)

    expect(await screen.findByText('TREASURY')).toBeTruthy()
    expect(await screen.findByText('Withdraw')).toBeTruthy()
    expect(await screen.findByText('ORACLE SEATS')).toBeTruthy()
    expect(await screen.findByText('Initialize oracle set')).toBeTruthy()
    expect(await screen.findByText('VERIFIER SEATS')).toBeTruthy()
    expect(await screen.findByText('Initialize verifier set')).toBeTruthy()
    expect(await screen.findByText('API ADMIN')).toBeTruthy()
  })
})

/* ── Deliberate confirmation ──────────────────────────────────────────────── */

describe('deliberate confirmation', () => {
  it('arms the withdraw confirmation only after typing the instruction name', async () => {
    const screen = await renderScreen(<AdminSettingsScreen />)

    await fireEvent.changeText(await screen.findByLabelText('Amount (USDC)'), '100')
    await fireEvent.press(screen.getByLabelText('Withdraw'))
    expect(await screen.findByText('Withdraw from the treasury?')).toBeTruthy()

    // Not armed: the confirm handler is literally undefined until the phrase matches.
    await fireEvent.press(screen.getByLabelText('Confirm'))
    expect(scenario.sendTxs).not.toHaveBeenCalled()
    expect(screen.getByText('Withdraw from the treasury?')).toBeTruthy()

    // Armed by the exact instruction name → one transaction goes out.
    await fireEvent.changeText(screen.getByLabelText('Type withdraw_treasury to confirm'), 'withdraw_treasury')
    await fireEvent.press(screen.getByLabelText('Confirm'))
    await waitFor(() => expect(scenario.sendTxs).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('Withdraw from the treasury?')).toBeNull())
    expect(await screen.findByText('Done.')).toBeTruthy()
  })

  it('shows the solvency shortfall and settles once confirmed', async () => {
    scenario.farm = FARM
    scenario.policy = ACTIVE_ENDED_POLICY
    scenario.reading = FINALIZED_READING
    scenario.balance = 4 // $4 in the vault vs $10 of coverage

    const screen = await renderScreen(<AdminSettingsScreen />)

    // The pre-demo checklist, made live: underfunded vault is called out…
    expect(await screen.findByText(/Short by/)).toBeTruthy()
    // …the trigger preview says what settlement would do…
    expect(await screen.findByText(/pays out/)).toBeTruthy()

    await fireEvent.press(await screen.findByLabelText('Settle policy'))
    expect(await screen.findByText('Settle the policy?')).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Type settle_policy to confirm'), 'settle_policy')
    await fireEvent.press(screen.getByLabelText('Confirm'))
    await waitFor(() => expect(scenario.sendTxs).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('Settle the policy?')).toBeNull())
  })

  it('keeps settle disarmed until the oracle finalizes', async () => {
    scenario.farm = FARM
    scenario.policy = ACTIVE_ENDED_POLICY
    scenario.reading = PENDING_READING
    scenario.balance = 4

    const screen = await renderScreen(<AdminSettingsScreen />)
    expect(await screen.findByText(/Not finalized yet/)).toBeTruthy()

    // Disabled button → onPress is undefined → nothing opens, nothing sends.
    await fireEvent.press(await screen.findByLabelText('Settle policy'))
    expect(scenario.sendTxs).not.toHaveBeenCalled()
    expect(screen.queryByText('Settle the policy?')).toBeNull()
  })
})
