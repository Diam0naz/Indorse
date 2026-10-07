/**
 * Render smoke tests for the redesigned screens.
 *
 * Each screen simulates a short chain fetch on mount, so these tests wait for
 * the loading skeleton to resolve (and, in the weather case, drive the
 * error → retry path) before asserting headline content. They are a cheap
 * guard against broken imports, missing context providers and SVG/layout
 * regressions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScoutingScreen from '@/app/(tabs)/index'
import WeatherScreen from '@/app/(tabs)/reports'
import ProfileScreen from '@/app/(tabs)/rewards'
import { NotificationsProvider, NotificationsSheet, useNotifications } from '@/components/notifications'
import { AuthProvider } from '@/components/auth-provider'
import { FarmRegistryProvider } from '@/components/farm-registry-provider'
import { ScoutLogProvider } from '@/components/scout-log-provider'
import { shortenAddress } from '@/lib/format'

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
}))

// expo-router pulls the `expo` package (→ expo-asset) into the module graph;
// screens only ever call the imperative API, which tests never assert on.
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('@react-native-clipboard/clipboard', () => ({
  default: { setString: vi.fn() },
}))

// The weather screen now mounts useRevokePolicy at the top level, which
// reaches useMobileWallet — no MobileWalletProvider exists in tests, so the
// wallet comes from this stand-in (same pattern as provenance.test.tsx).
const wallet = vi.hoisted(() => ({
  address: null as string | null,
  sendTransactions: vi.fn(async (_instructions: unknown[]) => undefined),
}))

vi.mock('@wallet-ui/react-native-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wallet-ui/react-native-kit')>()
  return {
    ...actual,
    useMobileWallet: () => ({
      account: wallet.address ? { address: wallet.address } : null,
      sendTransactions: wallet.sendTransactions,
    }),
  }
})

// The register modal pulls the mobile-wallet provider through its mutation
// hooks, which this file never mounts — the scout test only needs to know
// that the docked button mounts the modal.
vi.mock('@/components/register-farm-modal', async () => {
  const { Text } = await import('react-native')
  return { RegisterFarmModal: () => <Text testID="register-farm-modal">Register your farm</Text> }
})

/**
 * The scout tab's entry state lives in `scoutSetup`: `address` picks the
 * setup card's active step, `farm` decides dashboard vs setup card. The
 * chain reads are stubbed at the hook level (same layering as the weather
 * screen's policy reads) — the JSON-RPC path itself is exercised by
 * scout-chain.test.tsx.
 */
const scoutSetup = vi.hoisted(() => ({
  address: null as string | null,
  farm: null as null | { name: string; reportCount: number },
  toggleConnection: vi.fn(),
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: scoutSetup.address ? 'connected' : 'disconnected',
    address: scoutSetup.address,
    toggleConnection: scoutSetup.toggleConnection,
    error: null,
    clearError: vi.fn(),
  }),
}))

// The profile's admin-gated Settings entry reads the config PDA; no config
// here, so the entry stays hidden and the suite never touches the network.
vi.mock('@/features/admin/useConfigQuery', () => ({
  useConfigQuery: () => ({ config: null, state: 'ready' as const, retry: vi.fn() }),
}))

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({
    farm: scoutSetup.farm,
    farmAddress: scoutSetup.farm ? 'FARMqVz2s1hQM4aq2GPJ5dJEG8vN3yXkpRCn1oS9Ku2' : null,
    state: 'ready',
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/reports/useReportsQuery', () => ({
  useReportsQuery: () => ({ reports: [], state: 'ready', retry: vi.fn() }),
}))

// Pressing the setup card's scan entry mounts the real camera overlay: stub
// the location fix and submit hook the same way camera-overlay.test.tsx does
// (no submit is ever reached from these tests).
vi.mock('@/features/scout/location', () => ({
  getCurrentCoords: vi.fn(async () => ({ lat: 46.8821, lng: -98.7023, accuracy: 8 })),
  // The setup-signal read asks for the current grant — a test guest has none.
  getLocationPermission: vi.fn(async () => false),
  requestLocationPermission: vi.fn(async () => false),
}))

/**
 * The outbox flush drives this mutation directly; scenario-aware so the
 * hydration test can both observe the anchoring call and land it.
 */
const submitScenario = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => 'Report11111111111111111111111111111111111111'),
}))

vi.mock('@/features/reports/useSubmitReport', () => ({
  useSubmitReport: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
    mutateAsync: submitScenario.mutateAsync,
    reset: vi.fn(),
  }),
}))

/**
 * Claiming resolves the reward vault over RPC, so the hook is stubbed and
 * its state driven per-test — the row's claim path is what's under test,
 * not the vault discovery.
 */
const claimScenario = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
  variables: undefined as string | undefined,
}))

vi.mock('@/features/reports/useRewardReport', () => ({
  useRewardReport: () => ({
    isPending: claimScenario.isPending,
    isError: claimScenario.isError,
    error: claimScenario.error,
    variables: claimScenario.variables,
    mutate: claimScenario.mutate,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  }),
}))

// The profile reads SOL/USDC through the wallet-ui client, which no provider
// mounts here — hand back fixed balances instead.
vi.mock('@/features/wallet/useWalletBalances', () => ({
  useWalletBalances: () => ({ balances: { sol: 4.218, usdc: 1842.5 }, loading: false }),
}))

/**
 * The weather screen's policy + oracle reads are stubbed at the hook level:
 * these tests cover its rendering (mm scale, banners, retry) — the JSON-RPC
 * read path itself is exercised by scout-chain.test.tsx.
 */
const weatherScenario = vi.hoisted(() => ({
  policy: null as null | {
    seasonStart: number
    seasonEnd: number
    triggerThresholdMm: number
    coverageUsdc: number
    premiumUsdc: number
  },
  policyAddress: null as string | null,
  reading: null as null | {
    totalRainfallMm: number
    readingTimestamp: number
    finalized: boolean
    readings?: { oracle: string; totalRainfallMm: number }[]
  },
  oracleError: false,
  retry: vi.fn(),
}))

vi.mock('@/features/insurance/usePolicyQuery', () => ({
  usePolicyQuery: () => ({
    policy: weatherScenario.policy,
    policyAddress: weatherScenario.policyAddress,
    state: 'ready',
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/useWeatherOracleQuery', () => ({
  useWeatherOracleQuery: () => ({
    reading: weatherScenario.oracleError ? null : weatherScenario.reading,
    state: weatherScenario.oracleError ? 'error' : 'ready',
    retry: weatherScenario.retry,
  }),
}))

// The weather screen reads the oracle set for the tally's denominator —
// stubbed like the rest of its chain reads, so no RPC is reached in tests.
const oracleSetScenario = vi.hoisted(() => ({
  set: null as null | { k: number; members: string[] },
}))

vi.mock('@/features/admin/useOracleSetQuery', () => ({
  useOracleSetQuery: () => ({ set: oracleSetScenario.set, state: 'ready' as const, retry: vi.fn() }),
}))

/**
 * The Discover card reads the farm directory over HTTP — stubbed at the
 * hook layer like every other screen read: empty by default (the card
 * hides and nothing else changes), populated only by the discovery tests.
 */
const directoryScenario = vi.hoisted(() => ({
  farms: [] as unknown[],
  state: 'ready' as 'loading' | 'error' | 'ready',
  retry: vi.fn(),
}))

vi.mock('@/features/farm/useDirectoryQuery', () => ({
  useDirectoryQuery: () => ({
    farms: directoryScenario.farms,
    state: directoryScenario.state,
    retry: directoryScenario.retry,
  }),
}))

/** Simulated fetches resolve in 450–550ms; give each assertion room. */
const LOAD = { timeout: 3000 }

function renderWithProviders(ui: React.ReactElement) {
  // Queries (scout tab) need a QueryClient; retries stay off so a failed read
  // surfaces the error path instead of re-fetching for the whole test. The
  // scout log provider mounts as production does — hydration starts empty
  // unless a test seeds `indorse.scout.v1` first. AuthProvider covers the
  // profile's logout action, which reads the app-lock state. The farm
  // registry mounts as production does too — the profile's acreage total
  // reads it (empty unless a test seeds `indorse.farms.v1`).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FarmRegistryProvider>
        <AuthProvider>
          <NotificationsProvider>
            <ScoutLogProvider>{ui}</ScoutLogProvider>
          </NotificationsProvider>
        </AuthProvider>
      </FarmRegistryProvider>
    </QueryClientProvider>,
  )
}

/** Every test starts as a guest with no farm — later tests opt in. */
beforeEach(async () => {
  scoutSetup.address = null
  scoutSetup.farm = null
  scoutSetup.toggleConnection.mockClear()
  submitScenario.mutateAsync.mockClear()
  claimScenario.mutate.mockClear()
  claimScenario.isPending = false
  claimScenario.isError = false
  claimScenario.error = null
  claimScenario.variables = undefined
  // Stored captures are per-test: a seeded log must not hydrate the next one.
  await AsyncStorage.removeItem('indorse.scout.v1')
  // Same for the farm registry — the profile's acreage total reads it.
  await AsyncStorage.removeItem('indorse.farms.v1')
  // The weather scenario's oracle set (the tally denominator) resets too.
  oracleSetScenario.set = null
  // And the directory — discovery must not leak between tests.
  directoryScenario.farms = []
  directoryScenario.state = 'ready'
  directoryScenario.retry.mockClear()
})

/** Demo policy fixture: 180 mm trigger, $96k cover, 30 days left of season. */
const POLICY_ADDRESS = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'

/** The featured farm's PDA (the useFarmQuery mock) and a foreign farm. */
const OWN_ADDRESS = 'FARMqVz2s1hQM4aq2GPJ5dJEG8vN3yXkpRCn1oS9Ku2'
const OTHER_ADDRESS = 'DiscoverFarm1111111111111111111111111111111'

function seasonPolicy() {
  const now = Math.floor(Date.now() / 1000)
  return {
    seasonStart: now - 60 * 86_400,
    seasonEnd: now + 30 * 86_400,
    triggerThresholdMm: 1800, // 180.0 mm — the program's mm × 10 scale
    coverageUsdc: 96_000_000_000, // $96,000 max payout
    premiumUsdc: 960_000_000, // $960 premium
  }
}

function seasonReading() {
  // 212.0 mm of season rainfall, one day old — frozen at quorum as the
  // median of three signed votes (2100/2120/2140 on the mm × 10 scale).
  return {
    totalRainfallMm: 2120,
    readingTimestamp: Math.floor(Date.now() / 1000) - 86_400,
    finalized: true,
    readings: [
      { oracle: 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5', totalRainfallMm: 2100 },
      { oracle: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', totalRainfallMm: 2120 },
      { oracle: '5NKf5oVdKz5pPZqsMbxJFEZkNQh5fXTmBfqHcTzXvNsR', totalRainfallMm: 2140 },
    ],
  }
}

describe('screen redesign', () => {
  it('shows the setup card instead of seeded data when no farm exists', async () => {
    const screen = await renderWithProviders(<ScoutingScreen />)

    // Farm-less entry: the 3-step setup card replaces the dashboard — and
    // the docked action pills with it; the card carries the actions.
    await screen.findByText('Set up in 3 steps', {}, LOAD)
    expect(screen.queryByTestId('scout-actions')).toBeNull()
    expect(screen.queryByText('No scout events yet')).toBeNull()
    // The old sample rows, field cards and hint are gone for good.
    expect(screen.queryByText('Sclerotinia Head Rot')).toBeNull()
    expect(screen.queryByText('East Draw')).toBeNull()
    expect(screen.queryByText(/Sample log/)).toBeNull()
  })

  it('claims neither "all clear" nor attention when there is no data', async () => {
    // A registered farm with no reports: the real empty states show, and
    // with zero fields there is still nothing to call "clear".
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }

    const screen = await renderWithProviders(<ScoutingScreen />)

    await screen.findByText('No fields registered', {}, LOAD)
    // The empty state waits for the stored log to hydrate before claiming
    // there is nothing here — findBy covers that read.
    expect(await screen.findByText('No scout events yet', {}, LOAD)).toBeTruthy()
    expect(screen.queryByText('All fields clear')).toBeNull()
    expect(screen.queryByText(/fields need attention/)).toBeNull()
  })

  it('surfaces the oracle failure first and recovers on retry', async () => {
    weatherScenario.policy = seasonPolicy()
    weatherScenario.policyAddress = POLICY_ADDRESS
    weatherScenario.reading = seasonReading()
    weatherScenario.oracleError = true
    weatherScenario.retry.mockClear()

    const screen = await renderWithProviders(<WeatherScreen />)

    // First oracle push fails — the whole screen swaps to the error shell.
    await screen.findByText('Oracle feed unavailable', {}, LOAD)
    expect(screen.queryByText('Live Oracle Readings')).toBeNull()

    await fireEvent.press(screen.getByLabelText('Retry'))
    expect(weatherScenario.retry).toHaveBeenCalledTimes(1)

    weatherScenario.oracleError = false
    const recovered = await renderWithProviders(<WeatherScreen />)
    await recovered.findByText('Live Oracle Readings', {}, LOAD)
    expect(recovered.getByText('212 mm')).toBeTruthy()
  })

  it('states the rainfall reading and the trigger it is measured against', async () => {
    weatherScenario.policy = seasonPolicy()
    weatherScenario.policyAddress = POLICY_ADDRESS
    weatherScenario.reading = seasonReading()
    weatherScenario.oracleError = false

    const screen = await renderWithProviders(<WeatherScreen />)

    // The oracle reads rainfall in mm, matching what `settle_policy` compares —
    // reading and threshold share one scale so they can be read together.
    await screen.findByText('Live Oracle Readings', {}, LOAD)
    expect(screen.getByText(shortenAddress(POLICY_ADDRESS, 8))).toBeTruthy()
    expect(screen.getByText('$96000')).toBeTruthy()
    expect(screen.getByText('212 mm')).toBeTruthy()
    expect(screen.getByText('180 mm')).toBeTruthy()
    expect(screen.getByText('Payout triggers if season rainfall falls below 180 mm.')).toBeTruthy()
  })

  it('claims nothing before the quorum freezes the reading', async () => {
    weatherScenario.policy = seasonPolicy()
    weatherScenario.policyAddress = POLICY_ADDRESS
    // A half-counted tally: the account exists but its median is not final.
    weatherScenario.reading = { totalRainfallMm: 0, readingTimestamp: 0, finalized: false }
    weatherScenario.oracleError = false

    const screen = await renderWithProviders(<WeatherScreen />)

    await screen.findByText('Live Oracle Readings', {}, LOAD)
    // Zero is not a measurement: the rainfall value and its timestamp both
    // wait as em-dashes (the axis keeps its 0 mm scale marker), and the
    // chart holds its placeholder instead of drawing an unverified line.
    expect(screen.getByText('No readings yet')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('answers the contract question and names where the number came from', async () => {
    weatherScenario.policy = seasonPolicy()
    weatherScenario.policyAddress = POLICY_ADDRESS
    weatherScenario.reading = seasonReading()
    weatherScenario.oracleError = false

    const screen = await renderWithProviders(<WeatherScreen />)

    // 212 mm against the 180 mm trigger: the verdict says what the number
    // MEANS (32 mm over — no payout), provenance says who put it there.
    await screen.findByText('Live Oracle Readings', {}, LOAD)
    expect(await screen.findByText('No payout — 32 mm above trigger', {}, LOAD)).toBeTruthy()
    expect(screen.getByText('Median of 3 signed oracle readings')).toBeTruthy()
  })

  it('marks an open tally provisional — a partial count is not a fact', async () => {
    weatherScenario.policy = seasonPolicy()
    weatherScenario.policyAddress = POLICY_ADDRESS
    // Two votes in, quorum (3) not reached: the frozen median stays 0, so
    // the official slots keep their em-dashes while the votes still speak.
    weatherScenario.reading = {
      totalRainfallMm: 0,
      readingTimestamp: 0,
      finalized: false,
      readings: [
        { oracle: 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5', totalRainfallMm: 1500 },
        { oracle: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', totalRainfallMm: 1600 },
      ],
    }
    weatherScenario.oracleError = false
    oracleSetScenario.set = {
      k: 3,
      members: [
        'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5',
        '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        '5NKf5oVdKz5pPZqsMbxJFEZkNQh5fXTmBfqHcTzXvNsR',
      ],
    }

    const screen = await renderWithProviders(<WeatherScreen />)

    await screen.findByText('Live Oracle Readings', {}, LOAD)
    // Median of 1500/1600 → 1550 (mm × 10) → 155 mm, labelled provisional.
    expect(await screen.findByText('Provisional median 155 mm — not fact until quorum', {}, LOAD)).toBeTruthy()
    expect(screen.getByText('2 of 3 readings in — median not frozen')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('counts the open tally even before the oracle set is read', async () => {
    weatherScenario.policy = seasonPolicy()
    weatherScenario.policyAddress = POLICY_ADDRESS
    weatherScenario.reading = {
      totalRainfallMm: 0,
      readingTimestamp: 0,
      finalized: false,
      readings: [
        { oracle: 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5', totalRainfallMm: 1500 },
        { oracle: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', totalRainfallMm: 1600 },
      ],
    }
    weatherScenario.oracleError = false
    // K unknown (the set account is unread): the caption drops the
    // denominator rather than inventing one.
    oracleSetScenario.set = null

    const screen = await renderWithProviders(<WeatherScreen />)

    expect(await screen.findByText('2 readings in — median not frozen', {}, LOAD)).toBeTruthy()
  })

  it('shows the empty policy and chart states before anything is underwritten', async () => {
    weatherScenario.policy = null
    weatherScenario.policyAddress = null
    weatherScenario.reading = null
    weatherScenario.oracleError = false

    const screen = await renderWithProviders(<WeatherScreen />)

    await screen.findByText('No policy yet', {}, LOAD)
    expect(screen.getByText('No readings yet')).toBeTruthy()
    expect(screen.getByText('Live Oracle Readings')).toBeTruthy()
  })

  it('renders the operator profile with a disconnected wallet prompt', async () => {
    const screen = await renderWithProviders(<ProfileScreen />)

    // Setup banner: a guest has done none of the four signals yet.
    await screen.findByText('Guest Wallet', {}, LOAD)
    expect(screen.getByText('Complete your setup')).toBeTruthy()
    expect(screen.getByText('0 of 4 steps done')).toBeTruthy()
    expect(screen.getByText('Continue setup')).toBeTruthy()

    // Disconnected identity: the guest wallet name, em-dashes for farm rows.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('Escrow Locked')).toBeTruthy()
    expect(screen.getByText('Recent Activity')).toBeTruthy()

    // Disconnected edge case: connect prompt, muted balances, no pubkey.
    expect(screen.getByText('Wallet not connected')).toBeTruthy()
    expect(screen.getByText('Connect Wallet')).toBeTruthy()
    // Handle and pubkey both fall back to the same not-connected label.
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0)
  })

  it('totals the registry acreage the chain account cannot store', async () => {
    // Two device-local farms — acreage is local detail, so this registry
    // is the only home it has (the chain account has no such field).
    await AsyncStorage.setItem(
      'indorse.farms.v1',
      JSON.stringify({
        farms: [
          { id: 'a', name: 'Green Valley', lat: 34.052, lng: -118.243, source: 'local', acres: 120, addedAt: 1 },
          { id: 'b', name: 'East Draw', lat: 35.052, lng: -117.243, source: 'local', acres: 45.5, addedAt: 2 },
        ],
        currentId: 'a',
      }),
    )

    const screen = await renderWithProviders(<ProfileScreen />)

    // 120 + 45.5 — and a farm without acreage recorded contributes nothing.
    await screen.findByText('Total Acres', {}, LOAD)
    expect(await screen.findByText('165.5 ac', {}, LOAD)).toBeTruthy()
  })

  it('exposes the camera action to screen readers', async () => {
    const screen = await renderWithProviders(<ScoutingScreen />)

    // Onboarding: the setup card's scan entry is the labelled camera action
    // — scouting without a wallet starts here.
    await screen.findByText('Try a scan now', {}, LOAD)
    expect(screen.getByLabelText('Scout Field')).toBeTruthy()

    // It mounts the real overlay, no wallet and no farm needed.
    await fireEvent.press(screen.getByLabelText('Scout Field'))
    await screen.findByLabelText('Capture a shot', {}, LOAD)
  })

  it('folds Scout Field and Register farm behind a circle above the tab bar', async () => {
    // The dock belongs to the dashboard — it comes back once a farm exists.
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }

    const screen = await renderWithProviders(<ScoutingScreen />)

    await screen.findAllByText('Scout Field', {}, LOAD)

    // The stack is pinned, not part of the scrolling content.
    const stack = screen.getByTestId('scout-actions')
    expect(stack.props.style).toMatchObject({ position: 'absolute', bottom: 16 })

    // Both actions stay in the tree while folded — they animate, they don't
    // unmount — so screen readers keep a stable order in either state.
    expect(screen.getByLabelText('Scout field')).toBeTruthy()
    expect(screen.getByLabelText('Register farm')).toBeTruthy()

    // Folded, the pills are inert: tapping where they sit must do nothing.
    await fireEvent.press(screen.getByLabelText('Register farm'))
    expect(screen.queryByTestId('register-farm-modal')).toBeNull()

    // Unfolding the circle is what makes them live. Every press is awaited —
    // the fold's pointerEvents flip lands in its own act flush (RNTL v14).
    await fireEvent.press(screen.getByLabelText('Scouting actions'))
    await fireEvent.press(screen.getByLabelText('Register farm'))
    await screen.findByTestId('register-farm-modal', {}, LOAD)
  })

  it('drives setup from the card: connect, then register', async () => {
    // Guest → step 1 is active and its CTA connects the wallet.
    const guest = await renderWithProviders(<ScoutingScreen />)
    await guest.findByText('Set up in 3 steps', {}, LOAD)
    expect(guest.getByText('Connect your wallet')).toBeTruthy()
    expect(guest.getByText('Register your farm')).toBeTruthy()

    await fireEvent.press(guest.getByText('Connect wallet'))
    expect(scoutSetup.toggleConnection).toHaveBeenCalledTimes(1)

    // Connected → step 1 completes, step 2 owns the CTA → register modal.
    scoutSetup.address = POLICY_ADDRESS
    const connected = await renderWithProviders(<ScoutingScreen />)
    await connected.findByText('Set up in 3 steps', {}, LOAD)
    expect(connected.queryByTestId('scout-actions')).toBeNull()

    await fireEvent.press(connected.getByText('Register farm'))
    await connected.findByTestId('register-farm-modal', {}, LOAD)
  })

  it('hydrates scans captured in an earlier session and anchors them on retry', async () => {
    // A capture from a previous session, parked as `failed` by an anchor
    // attempt that did not land — payload intact, restart or not.
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }
    const stored = {
      id: 'sc1712000000000',
      date: 'Oct 4',
      field: 'Unregistered area',
      crop: '—',
      diagnosis: 'Late blight',
      confidence: 0.91,
      severity: 'high',
      txSig: 'ab'.repeat(32),
      notes: 'Lesions on lower leaves.',
      images: 1,
      lat: 46.8821,
      lng: -98.7023,
      anchorStatus: 'failed',
      anchor: {
        photoHashHex: 'ab'.repeat(32),
        uri: 'indorse://scout/1712000000000.jpg',
        aiLabel: 'Late blight',
        photoUris: [],
      },
    }
    await AsyncStorage.setItem('indorse.scout.v1', JSON.stringify({ events: [stored] }))

    const screen = await renderWithProviders(<ScoutingScreen />)

    // The row renders from disk with its honest anchoring state — and a
    // failed row never self-retries into a silent loop.
    await screen.findByText('Late blight', {}, LOAD)
    await screen.findByText('Anchor failed', {}, LOAD)
    expect(submitScenario.mutateAsync).not.toHaveBeenCalled()

    // Expanded: the detail calls the digest what it is, not an on-chain tx.
    await fireEvent.press(screen.getByText('Late blight'))
    expect(screen.getByText('Photo digest')).toBeTruthy()
    expect(screen.getByText('1 captured')).toBeTruthy()

    // The explicit retry re-arms the row; the outbox then anchors it with
    // exactly what the capture stored — hash, uri, label, coordinates.
    await fireEvent.press(screen.getByLabelText('Retry anchoring'))
    await waitFor(() => expect(submitScenario.mutateAsync).toHaveBeenCalledTimes(1), LOAD)
    expect(submitScenario.mutateAsync).toHaveBeenCalledWith({
      farmAddress: 'FARMqVz2s1hQM4aq2GPJ5dJEG8vN3yXkpRCn1oS9Ku2',
      photoHash: Array(32).fill(0xab),
      uri: 'indorse://scout/1712000000000.jpg',
      lat: 46.8821,
      lng: -98.7023,
      aiLabel: 'Late blight',
    })

    // The row became its on-chain identity: badge gone, payload released,
    // report address stored as id and tx — all of it persisted.
    await waitFor(() => expect(screen.queryByText('Anchor failed')).toBeNull(), LOAD)
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem('indorse.scout.v1')) ?? '{}') as {
        events: { id: string; txSig: string; field: string; chainStatus: string; anchorStatus: string }[]
      }
      expect(doc.events[0]).toMatchObject({
        id: 'Report11111111111111111111111111111111111111',
        txSig: 'Report11111111111111111111111111111111111111',
        field: 'Green Valley',
        chainStatus: 'pending',
        anchorStatus: 'anchored',
      })
      expect(doc.events[0]).not.toHaveProperty('anchor')
    }, LOAD)
    expect(screen.queryByLabelText('Retry anchoring')).toBeNull()
  })

  it('offers the SKR claim only on a verified report', async () => {
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }
    // Two anchored rows: the chain's own review status is what separates a
    // claimable report from one the program would still refuse.
    const verified = {
      id: 'ReportVerified',
      date: 'Oct 4',
      field: 'Green Valley',
      crop: '—',
      diagnosis: 'Late blight',
      confidence: 0,
      severity: 'none',
      txSig: 'ReportVerified',
      notes: 'indorse://scout/v.jpg',
      images: 1,
      lat: 46.8821,
      lng: -98.7023,
      chainStatus: 'verified',
    }
    const pending = {
      ...verified,
      id: 'ReportPending',
      txSig: 'ReportPending',
      diagnosis: 'Early blight',
      chainStatus: 'pending',
    }
    await AsyncStorage.setItem('indorse.scout.v1', JSON.stringify({ events: [verified, pending] }))

    const screen = await renderWithProviders(<ScoutingScreen />)
    await screen.findByText('Late blight', {}, LOAD)

    // Expanded, a verified report offers the claim — and the tap names the
    // report account, which is where the hook reads its reporter back from.
    await fireEvent.press(screen.getByText('Late blight'))
    const claim = await screen.findByLabelText('Claim SKR reward', {}, LOAD)
    await fireEvent.press(claim)
    expect(claimScenario.mutate).toHaveBeenCalledWith('ReportVerified')

    // The pending row next to it shows the status and nothing to claim.
    await fireEvent.press(screen.getByText('Early blight'))
    expect(screen.queryByLabelText('Claim SKR reward')).toBeNull()
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('gates deletion behind a confirm and erases the row only on confirm', async () => {
    // A local capture from an earlier session. Deleting is device-local —
    // the chain, if any, keeps its own copy — so the tap must be gated.
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }
    await AsyncStorage.clear()
    const stored = {
      id: 'sc1712000000002',
      date: 'Oct 6',
      field: 'Unregistered area',
      crop: '—',
      diagnosis: 'Powdery mildew',
      confidence: 0.82,
      severity: 'medium',
      txSig: 'ef'.repeat(32),
      notes: 'White film on upper leaves.',
      images: 1,
      lat: 46.8821,
      lng: -98.7023,
      anchorStatus: 'failed',
      anchor: {
        photoHashHex: 'cd'.repeat(32),
        uri: 'indorse://scout/1712000000002.jpg',
        aiLabel: 'Powdery mildew',
        photoUris: [],
      },
    }
    await AsyncStorage.setItem('indorse.scout.v1', JSON.stringify({ events: [stored] }))

    const screen = await renderWithProviders(<ScoutingScreen />)
    await screen.findByText('Powdery mildew', {}, LOAD)
    await fireEvent.press(screen.getByText('Powdery mildew'))

    // The tap opens the gate and the gate is honest about the limits;
    // declining it leaves the row untouched.
    await fireEvent.press(screen.getByLabelText('Delete entry'))
    await screen.findByTestId('scout-delete-confirm', {}, LOAD)
    expect(
      screen.getByText('The capture and its photos are removed from this device. On-chain records stay on-chain.'),
    ).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Close camera'))
    expect(screen.getByText('Powdery mildew')).toBeTruthy()

    // Reopening and confirming erases it — the store too, not just the row.
    await fireEvent.press(screen.getByLabelText('Delete entry'))
    await screen.findByTestId('scout-delete-confirm', {}, LOAD)
    await fireEvent.press(screen.getByTestId('scout-delete-confirm'))
    await waitFor(() => expect(screen.queryByText('Powdery mildew')).toBeNull())
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem('indorse.scout.v1')) ?? '{}')
      expect(doc.events).toHaveLength(0)
    })
  })

  /* ── Cross-farm discovery ───────────────────────────────────── */

  it('discovers other farms, arms the scout target from the sheet, and stands down from the badge', async () => {
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }
    // The device's own chain farm is in the registry — and also listed in
    // the directory below. The card must drop it: own farms live in the
    // switcher, never in discovery.
    await AsyncStorage.setItem(
      'indorse.farms.v1',
      JSON.stringify({
        farms: [
          {
            id: 'chain-0',
            name: 'Green Valley',
            lat: 46.8821,
            lng: -98.7023,
            source: 'chain',
            address: OWN_ADDRESS,
            reportCount: 0,
            addedAt: 1,
          },
        ],
        currentId: 'chain-0',
      }),
    )
    const ownListing = {
      address: OWN_ADDRESS,
      name: 'Own Farm Listing',
      lat: 46.8821,
      lng: -98.7023,
      owner: 'x',
      reportCount: 0,
      verifiedReportCount: 0,
      batchCount: 0,
      policyCount: 0,
      updatedAt: 1,
    }
    const other = {
      address: OTHER_ADDRESS,
      // At the device position — the mocked fix pins its distance to 0 m.
      name: 'Rowan Ridge',
      lat: 46.8821,
      lng: -98.7023,
      owner: 'y',
      reportCount: 3,
      verifiedReportCount: 1,
      batchCount: 0,
      policyCount: 0,
      updatedAt: 1,
    }
    directoryScenario.farms = [ownListing, other]

    const screen = await renderWithProviders(<ScoutingScreen />)

    // The foreign farm lists with its decision-ready facts…
    expect(await screen.findByText('Rowan Ridge', {}, LOAD)).toBeTruthy()
    expect(screen.getByText('33%')).toBeTruthy()
    expect(await screen.findByText('0 m · 1 of 3 verified', {}, LOAD)).toBeTruthy()
    expect(screen.getByText(/2 awaiting verification/)).toBeTruthy()
    // …and the roster's own farm never does, once the registry hydrates.
    await waitFor(() => expect(screen.queryByText('Own Farm Listing')).toBeNull(), LOAD)

    // The sheet carries the chain-public detail the card promised.
    await fireEvent.press(screen.getByTestId(`discover-row-${OTHER_ADDRESS}`))
    await screen.findByText('46.88210, -98.70230', {}, LOAD)
    expect(screen.getByText(OTHER_ADDRESS)).toBeTruthy()
    expect(screen.getByText('Distance')).toBeTruthy()
    expect(screen.getByText('0 m')).toBeTruthy()
    expect(screen.getByText('Reports')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('Verified')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()

    // Arming the target closes the sheet and rides the dock badge…
    await fireEvent.press(screen.getByTestId('discover-scout'))
    expect(screen.queryByTestId('discover-scout')).toBeNull()
    await screen.findByText('Scouting Rowan Ridge', {}, LOAD)

    // …and the badge is the way back: tap it to scout your own farm again.
    await fireEvent.press(screen.getByTestId('scout-target-badge'))
    await waitFor(() => expect(screen.queryByTestId('scout-target-badge')).toBeNull(), LOAD)
  })

  it('states a directory failure honestly without breaking the rest of the scout screen', async () => {
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }
    directoryScenario.state = 'error'

    const screen = await renderWithProviders(<ScoutingScreen />)

    await screen.findByText('Directory unreachable', {}, LOAD)
    expect(screen.getByText('The farm directory could not load. Your own scouting is unaffected.')).toBeTruthy()
    // The dashboard around it keeps working — and the retry is wired.
    expect(screen.getByText('Field Status')).toBeTruthy()
    expect(screen.getByText('Scouting Log · 0')).toBeTruthy()
    await fireEvent.press(screen.getByText('Retry'))
    expect(directoryScenario.retry).toHaveBeenCalled()
  })

  it('anchors a queued capture to the farm it was stamped with, not the featured one', async () => {
    scoutSetup.address = POLICY_ADDRESS
    scoutSetup.farm = { name: 'Green Valley', reportCount: 0 }
    const common = {
      date: 'Oct 4',
      crop: '—',
      diagnosis: 'Late blight',
      confidence: 0.91,
      severity: 'high',
      txSig: 'ab'.repeat(32),
      notes: 'Lesions on lower leaves.',
      images: 1,
      lat: 46.8821,
      lng: -98.7023,
      anchorStatus: 'queued',
    }
    // Captured while scouting the foreign farm — stamped at capture time.
    const stamped = {
      ...common,
      id: 'scStamped',
      field: 'Rowan Ridge',
      anchor: {
        photoHashHex: 'ab'.repeat(32),
        uri: 'indorse://scout/1.jpg',
        aiLabel: 'Late blight',
        photoUris: [],
        farmAddress: OTHER_ADDRESS,
      },
    }
    // An ordinary capture from before discovery — no farm in its payload.
    const plain = {
      ...common,
      id: 'scPlain',
      field: 'Unregistered area',
      anchor: { photoHashHex: 'cd'.repeat(32), uri: 'indorse://scout/2.jpg', aiLabel: 'Early blight', photoUris: [] },
    }
    await AsyncStorage.setItem('indorse.scout.v1', JSON.stringify({ events: [stamped, plain] }))
    submitScenario.mutateAsync
      .mockImplementationOnce(async () => 'ReportAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
      .mockImplementationOnce(async () => 'ReportBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')

    await renderWithProviders(<ScoutingScreen />)

    // Both rows anchor on the first pass, in capture order — but each to
    // its own farm: the stamp wins for the stamped capture.
    await waitFor(() => expect(submitScenario.mutateAsync).toHaveBeenCalledTimes(2), LOAD)
    expect(submitScenario.mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ farmAddress: OTHER_ADDRESS }),
    )
    expect(submitScenario.mutateAsync).toHaveBeenNthCalledWith(2, expect.objectContaining({ farmAddress: OWN_ADDRESS }))

    // Each row keeps the identity it was captured under — the target's
    // name for the stamped capture, the featured farm's for the other.
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem('indorse.scout.v1')) ?? '{}') as {
        events: { field: string; anchorStatus: string }[]
      }
      expect(doc.events).toHaveLength(2)
      const fields = doc.events.map((event) => event.field)
      expect(fields).toContain('Rowan Ridge')
      expect(fields).toContain('Green Valley')
      expect(doc.events.every((event) => event.anchorStatus === 'anchored')).toBe(true)
    }, LOAD)
  })
})

/* ── Notification state ─────────────────────────────────────────────── */

/** Probe: the feed as the provider exposes it, plus a trigger for real items. */
function FeedProbe() {
  const { unread, add, markAllRead } = useNotifications()
  const pushEscrow = () =>
    add({ type: 'escrow', title: 'Escrow funded', body: 'Grain Partners Co-op deposited into escrow.' })
  return (
    <>
      <Text testID="unread">{String(unread)}</Text>
      <Text testID="add" onPress={pushEscrow}>
        add
      </Text>
      <Text testID="mark-all" onPress={markAllRead}>
        mark all
      </Text>
      <NotificationsSheet visible onClose={() => {}} />
    </>
  )
}

describe('notifications', () => {
  it('starts empty and tracks items added in the session', async () => {
    const screen = await render(
      <NotificationsProvider>
        <FeedProbe />
      </NotificationsProvider>,
    )

    expect(screen.getByTestId('unread').children).toContain('0')
    await fireEvent.press(screen.getByTestId('add'))
    expect(screen.getByTestId('unread').children).toContain('1')
    await fireEvent.press(screen.getByTestId('mark-all'))
    expect(screen.getByTestId('unread').children).toContain('0')
  })

  it('lists only what actually happened, never seeded rows', async () => {
    const screen = await render(
      <NotificationsProvider>
        <FeedProbe />
      </NotificationsProvider>,
    )

    // Fresh feed: caught up, no unread badge, no seeded titles.
    expect(screen.getByText("You're all caught up")).toBeTruthy()
    expect(screen.queryByText('2 unread')).toBeNull()
    expect(screen.queryByText('High-severity diagnosis')).toBeNull()

    await fireEvent.press(screen.getByTestId('add'))
    await screen.findByText('Escrow funded', {}, LOAD)
    expect(screen.getByText('1 unread')).toBeTruthy()
    expect(screen.getByText('just now')).toBeTruthy()
  })

  it('clears back to the caught-up empty state', async () => {
    const screen = await render(
      <NotificationsProvider>
        <FeedProbe />
      </NotificationsProvider>,
    )

    await fireEvent.press(screen.getByTestId('add'))
    await screen.findByText('Escrow funded', {}, LOAD)

    await fireEvent.press(screen.getByText('Clear'))
    await screen.findByText("You're all caught up", {}, LOAD)
    expect(screen.queryByText('Escrow funded')).toBeNull()
  })
})
