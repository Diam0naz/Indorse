/**
 * Settings stack tests
 *
 * Covers the wiring the settings screens promise: the notification switches
 * actually gate the feed, the language and theme pickers re-render through
 * their contexts, the network screen drives a real RPC round trip, the CSV
 * export reaches the clipboard/share sheet, and the security screen's
 * "hide balances" preference masks the profile.
 *
 * Native/expo modules are mocked below; contexts fall back to their safe
 * defaults, so each screen also renders without a provider where possible.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Clipboard from '@react-native-clipboard/clipboard'
import * as Sharing from 'expo-sharing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import NotificationSettingsScreen from '@/app/settings/notifications'
import SecuritySettingsScreen from '@/app/settings/security'
import NetworkSettingsScreen from '@/app/settings/network'
import ExportSettingsScreen from '@/app/settings/export'
import LanguageSettingsScreen from '@/app/settings/language'
import ThemeSettingsScreen from '@/app/settings/theme'
import ProfileScreen from '@/app/(tabs)/rewards'
import { NotificationsProvider, NotificationsSheet, useNotifications } from '@/components/notifications'
import { AuthProvider } from '@/components/auth-provider'
import { SettingsProvider } from '@/components/settings-provider'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import type { ChainReport } from '@/features/reports/useReportsQuery'
import { buildFieldsFromReports } from '@/features/scout/fields'
import { LanguageProvider, useI18n } from '@/lib/i18n'
import { farmRecordRowCount, type FarmRecordInput } from '@/lib/csv'

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

vi.mock('@react-native-clipboard/clipboard', () => ({
  default: { setString: vi.fn() },
}))

// Address follows the export suite's scenario (reset to null before every
// test in the beforeEach below, so the Profile/notification suites keep
// seeing a guest). The export screen derives everything from this hook.
vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: exportScenario.address ? 'connected' : 'disconnected',
    address: exportScenario.address,
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

// The profile reads SOL/USDC through the wallet-ui client, which no provider
// mounts here — hand back the demo balances instead.
vi.mock('@/features/wallet/useWalletBalances', () => ({
  useWalletBalances: () => ({ balances: { sol: 4.218, usdc: 1842.5 }, loading: false }),
}))

// The profile's admin-gated Settings entry reads the config PDA; no config
// here, so the entry stays hidden and the suite never touches the network.
vi.mock('@/features/admin/useConfigQuery', () => ({
  useConfigQuery: () => ({ config: null, state: 'ready' as const, retry: vi.fn() }),
}))

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/cache/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: vi.fn(async () => undefined),
}))

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => undefined),
}))

const LOAD = { timeout: 3000 }

/** Preferences persist in the AsyncStorage mock — start each test from defaults. */
beforeEach(async () => {
  await AsyncStorage.clear()
})

/**
 * The export suite's chain scenario is file-level state shared by its hook
 * mocks; reset it before every test so neither later suites (ProfileScreen
 * mounts the same hooks) nor Clipboard/Sharing call history leak across.
 */
beforeEach(() => {
  vi.clearAllMocks()
  exportScenario.address = null
  exportScenario.farm = null
  exportScenario.reports = []
  exportScenario.escrow = null
  exportScenario.policy = null
  exportScenario.reading = null
})

/* ── Notification settings → feed ─────────────────────────────────────────── */

/** Push one real item so the push-off filter has something to hide. */
function PushEscrowItem() {
  const { add } = useNotifications()
  return (
    <Text
      testID="add-notif"
      onPress={() => add({ type: 'escrow', title: 'Escrow funded', body: 'Deposited into escrow.' })}
    >
      add
    </Text>
  )
}

describe('notification settings', () => {
  it('turning push off empties the notification feed', async () => {
    const screen = await render(
      <SettingsProvider>
        <NotificationsProvider>
          <NotificationSettingsScreen />
          <NotificationsSheet visible onClose={() => {}} />
          <PushEscrowItem />
        </NotificationsProvider>
      </SettingsProvider>,
    )

    // The feed starts empty — push a real item so there is something to hide.
    expect(screen.getByText("You're all caught up")).toBeTruthy()
    await fireEvent.press(screen.getByTestId('add-notif'))
    await screen.findByText('Escrow funded', {}, LOAD)

    fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', false)

    await screen.findByText("You're all caught up", {}, LOAD)
    expect(screen.queryByText('Escrow funded')).toBeNull()
  })

  it('locks the badge and category switches while push is off', async () => {
    const screen = await render(
      <SettingsProvider>
        <NotificationSettingsScreen />
      </SettingsProvider>,
    )

    expect(screen.getByLabelText('Diagnosis alerts').props.accessibilityState?.disabled).not.toBe(true)

    fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', false)

    await waitFor(() => {
      expect(screen.getByLabelText('Diagnosis alerts').props.accessibilityState?.disabled).toBe(true)
    })
    expect(screen.getByLabelText('Unread badge').props.accessibilityState?.disabled).toBe(true)
  })
})

/* ── Language ─────────────────────────────────────────────────────────────── */

function LanguageProbe() {
  const { t, lang } = useI18n()
  return <Text testID="lang">{`${lang}:${t('profile.settings')}`}</Text>
}

describe('language settings', () => {
  it('switches the app to Español and re-renders labels', async () => {
    const screen = await render(
      <LanguageProvider>
        <LanguageSettingsScreen />
        <LanguageProbe />
      </LanguageProvider>,
    )

    expect(screen.getByTestId('lang').props.children).toContain('en:Settings')
    expect(screen.getByText('Language')).toBeTruthy()

    fireEvent.press(screen.getByText('Español'))

    await waitFor(() => {
      expect(screen.getByTestId('lang').props.children).toContain('es:Ajustes')
    })
    expect(screen.getByText('Idioma')).toBeTruthy()
  })
})

/* ── Theme ────────────────────────────────────────────────────────────────── */

function ThemeProbe() {
  const { mode, resolved } = useTheme()
  return <Text testID="theme">{`${mode}:${resolved}`}</Text>
}

describe('theme settings', () => {
  it('selecting Light Paper flips the resolved theme', async () => {
    const screen = await render(
      <ThemeProvider>
        <ThemeSettingsScreen />
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('theme').props.children).toContain('dark')
    expect(screen.getByText('Dark Field')).toBeTruthy()

    fireEvent.press(screen.getByLabelText('Light Paper'))

    await waitFor(() => {
      expect(screen.getByTestId('theme').props.children).toBe('light:light')
    })
  })

  it('hides the Seeker Midnight row off-Seeker', async () => {
    const screen = await render(
      <ThemeProvider>
        <ThemeSettingsScreen />
      </ThemeProvider>,
    )

    expect(screen.queryByText('Seeker Midnight')).toBeNull()
    expect(screen.getByText('Dark Field')).toBeTruthy()
  })

  it('offers and applies Seeker Midnight on a Seeker', async () => {
    process.env.EXPO_PUBLIC_FORCE_SEEKER = 'true'
    const screen = await render(
      <ThemeProvider>
        <ThemeSettingsScreen />
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByText('Seeker Midnight')).toBeTruthy()

    fireEvent.press(screen.getByLabelText('Seeker Midnight'))

    await waitFor(() => {
      // Seeker is a dark palette: mode reports itself, status bar stays dark.
      expect(screen.getByTestId('theme').props.children).toBe('seeker:dark')
    })

    delete process.env.EXPO_PUBLIC_FORCE_SEEKER
  })
})

/* ── Network ──────────────────────────────────────────────────────────────── */

describe('network settings', () => {
  it('reports a healthy RPC with latency and slot', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ jsonrpc: '2.0', id: 1, result: 312345678 }) }))
    vi.stubGlobal('fetch', fetchMock)

    const screen = await render(<NetworkSettingsScreen />)
    await screen.findByText(/Healthy · \d+ ms/, {}, LOAD)

    expect(fetchMock).toHaveBeenCalled()
    expect(screen.getByText(/Slot 312345678/)).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('surfaces the unreachable state when the endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const screen = await render(<NetworkSettingsScreen />)
    await screen.findByText('RPC unreachable', {}, LOAD)

    expect(screen.getByText(/did not answer/)).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

/* ── Export ───────────────────────────────────────────────────────────────── */

const exportScenario = vi.hoisted(() => ({
  address: null as string | null,
  farm: null as null | {
    name: string
    owner: string
    latE6: number
    lngE6: number
    address?: string
    reportCount: number
    batchCount: number
    policyCount: number
  },
  reports: [] as unknown[],
  escrow: null as null | { buyer: string; amountUsdc: number; address?: string },
  policy: null as null | {
    coverageUsdc: number
    premiumUsdc: number
    triggerThresholdMm: number
    seasonStart: number
    seasonEnd: number
    state: string
    address?: string
  },
  reading: null as null | { totalRainfallMm: number; readingTimestamp: number },
}))

// The export screen reads through the same hooks the tabs use; this suite
// simulates the chain at the hook boundary (the RPC level itself is
// scout-chain.test's job).
vi.mock('@wallet-ui/react-native-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wallet-ui/react-native-kit')>()
  return {
    ...actual,
    useMobileWallet: () => ({
      account: exportScenario.address ? { address: exportScenario.address } : null,
      sendTransactions: vi.fn(),
    }),
  }
})

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({
    farm: exportScenario.farm,
    farmAddress: exportScenario.farm?.address ?? null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/reports/useReportsQuery', () => ({
  useReportsQuery: () => ({ reports: exportScenario.reports, state: 'ready' as const, retry: vi.fn() }),
}))

vi.mock('@/features/escrow/useEscrowQuery', () => ({
  useEscrowQuery: () => ({
    escrow: exportScenario.escrow,
    escrowAddress: exportScenario.escrow?.address ?? null,
    batchAddress: null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/usePolicyQuery', () => ({
  usePolicyQuery: () => ({
    policy: exportScenario.policy,
    policyAddress: exportScenario.policy?.address ?? null,
    state: 'ready' as const,
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/useWeatherOracleQuery', () => ({
  useWeatherOracleQuery: () => ({ reading: exportScenario.reading, state: 'ready' as const, retry: vi.fn() }),
}))

const EXPORT_FARM = {
  name: 'Red Creek Farm',
  owner: 'Owner111111111111111111111111111111111111111',
  latE6: 46_882_100,
  lngE6: -98_702_300,
  address: 'Farm111111111111111111111111111111111111111',
  reportCount: 1,
  batchCount: 1,
  policyCount: 1,
}

const EXPORT_REPORT: ChainReport = {
  farm: 'FarmAcc111111111111111111111111111111111111',
  reporter: 'Owner111111111111111111111111111111111111111',
  index: 0,
  photoHash: [1, 2, 3],
  uri: 'https://cdn.indorse.app/scout/fixture.jpg',
  latE6: 46_882_110,
  lngE6: -98_702_310,
  aiLabel: 'Downy Mildew',
  status: 'verified',
  verifier: 'Verifier11111111111111111111111111111111111',
  timestamp: 1_758_000_000,
  bump: 250,
  address: 'Report1111111111111111111111111111111111111',
}

const EXPORT_ESCROW = {
  buyer: 'Buyer111111111111111111111111111111111111111',
  amountUsdc: 45_200_000_000,
  address: 'Escrow1111111111111111111111111111111111111',
}

const EXPORT_POLICY = {
  coverageUsdc: 5_000_000,
  premiumUsdc: 250_000,
  triggerThresholdMm: 500,
  seasonStart: Date.UTC(2026, 3, 1) / 1000,
  seasonEnd: Date.UTC(2026, 9, 15) / 1000,
  state: 'active',
  address: 'Policy1111111111111111111111111111111111111',
}

const EXPORT_READING = { totalRainfallMm: 2_120, readingTimestamp: 1_758_100_000 }

/** What the screen should assemble for the populated scenario. */
const EXPORT_EXPECTED: FarmRecordInput = {
  farm: EXPORT_FARM,
  operator: '',
  reports: [EXPORT_REPORT],
  fields: buildFieldsFromReports([EXPORT_REPORT], EXPORT_FARM.name),
  escrow: EXPORT_ESCROW,
  policy: EXPORT_POLICY,
  reading: EXPORT_READING,
  exportedAt: new Date(),
}

function renderExport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ExportSettingsScreen />
    </QueryClientProvider>,
  )
}

describe('export farm record', () => {
  function populateRecord() {
    exportScenario.address = EXPORT_FARM.owner
    exportScenario.farm = EXPORT_FARM
    exportScenario.reports = [EXPORT_REPORT]
    exportScenario.escrow = EXPORT_ESCROW
    exportScenario.policy = EXPORT_POLICY
    exportScenario.reading = EXPORT_READING
  }

  it('previews the chain record and copies it to the clipboard', async () => {
    populateRecord()
    const screen = await renderExport()

    // Header visible in the preview + the row count matches the builder.
    await screen.findByText(/record_type,farm_name/, {}, LOAD)
    expect(screen.getByText(new RegExp(`^${farmRecordRowCount(EXPORT_EXPECTED)} rows`))).toBeTruthy()
    expect(screen.queryByText('Connect a wallet to export')).toBeNull()

    await fireEvent.press(screen.getByLabelText('Copy CSV'))
    expect(Clipboard.setString).toHaveBeenCalledWith(expect.stringContaining('Red Creek Farm'))
    expect(Clipboard.setString).toHaveBeenCalledWith(expect.stringContaining('Downy Mildew'))
  })

  it('writes the file and hands it to the share sheet', async () => {
    populateRecord()
    const screen = await renderExport()

    await fireEvent.press(screen.getByLabelText('Share .csv file'))

    await waitFor(() => {
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        expect.stringMatching(/red-creek-farm-\d{4}-\d{2}-\d{2}\.csv$/),
        expect.objectContaining({ mimeType: 'text/csv' }),
      )
    })
    expect(screen.queryByText('Could not share the file')).toBeNull()
  })

  it('states that a guest has nothing to export and blocks both actions', async () => {
    const screen = await renderExport()

    await screen.findByText('Connect a wallet to export', {}, LOAD)
    expect((await screen.findAllByText(/^0 rows/)).length).toBeGreaterThan(0)

    await fireEvent.press(screen.getByLabelText('Copy CSV'))
    await fireEvent.press(screen.getByLabelText('Share .csv file'))
    expect(Clipboard.setString).not.toHaveBeenCalled()
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
  })

  it('offers the empty state for a wallet with no registered farm', async () => {
    exportScenario.address = EXPORT_FARM.owner
    const screen = await renderExport()

    await screen.findByText('Nothing to export yet', {}, LOAD)
    expect(screen.queryByText('Connect a wallet to export')).toBeNull()
    expect((await screen.findAllByText(/^0 rows/)).length).toBeGreaterThan(0)
  })
})

/* ── Profile entry points + display preference ────────────────────────────── */

describe('profile settings', () => {
  // The profile composes TanStack queries (farm, reports, escrow, balances);
  // a client keeps them inert without touching the network.
  function renderProfile(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  }

  it('lists every settings destination', async () => {
    // The profile now carries the logout action, which reads the app-lock
    // state — same AuthProvider requirement as the security screen below.
    const screen = await renderProfile(
      <AuthProvider>
        <ProfileScreen />
      </AuthProvider>,
    )

    // Disconnected: the identity falls back to the guest wallet name.
    await screen.findByText('Guest Wallet', {}, LOAD)
    expect(screen.getByText('Notification Settings')).toBeTruthy()
    expect(screen.getByText('Wallet & Security')).toBeTruthy()
    expect(screen.getByText('Network: Devnet')).toBeTruthy()
    expect(screen.getByText('Export Farm Record')).toBeTruthy()
    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.getByText('Theme')).toBeTruthy()
  })

  it('masks balances when hide-balances is switched on', async () => {
    const screen = await renderProfile(
      <SettingsProvider>
        {/* The security screen reads the app-lock state, so it needs AuthProvider. */}
        <AuthProvider>
          <SecuritySettingsScreen />
          <ProfileScreen />
        </AuthProvider>
      </SettingsProvider>,
    )

    await screen.findByText('Guest Wallet', {}, LOAD)
    expect(screen.queryByText('•••')).toBeNull()

    fireEvent(screen.getByLabelText('Hide balances'), 'valueChange', true)

    await waitFor(() => {
      // SOL, USDC and escrow rows are all masked.
      expect(screen.getAllByText('•••')).toHaveLength(3)
    })
  })
})
