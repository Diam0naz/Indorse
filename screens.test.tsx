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
  reading: null as null | { totalRainfallMm: number; readingTimestamp: number },
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

/** Simulated fetches resolve in 450–550ms; give each assertion room. */
const LOAD = { timeout: 3000 }

function renderWithProviders(ui: React.ReactElement) {
  // Queries (scout tab) need a QueryClient; retries stay off so a failed read
  // surfaces the error path instead of re-fetching for the whole test. The
  // scout log provider mounts as production does — hydration starts empty
  // unless a test seeds `indorse.scout.v1` first.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsProvider>
        <ScoutLogProvider>{ui}</ScoutLogProvider>
      </NotificationsProvider>
    </QueryClientProvider>,
  )
}

/** Every test starts as a guest with no farm — later tests opt in. */
beforeEach(async () => {
  scoutSetup.address = null
  scoutSetup.farm = null
  scoutSetup.toggleConnection.mockClear()
  submitScenario.mutateAsync.mockClear()
  // Stored captures are per-test: a seeded log must not hydrate the next one.
  await AsyncStorage.removeItem('indorse.scout.v1')
})

/** Demo policy fixture: 180 mm trigger, $96k cover, 30 days left of season. */
const POLICY_ADDRESS = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'

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
  // 212.0 mm of season rainfall, one day old.
  return { totalRainfallMm: 2120, readingTimestamp: Math.floor(Date.now() / 1000) - 86_400 }
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
