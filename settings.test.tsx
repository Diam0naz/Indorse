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
import { NotificationsProvider, NotificationsSheet } from '@/components/notifications'
import { AuthProvider } from '@/components/auth-provider'
import { SettingsProvider } from '@/components/settings-provider'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { LanguageProvider, useI18n } from '@/lib/i18n'
import { farmRecordRowCount } from '@/lib/csv'

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

// The profile reads SOL/USDC through the wallet-ui client, which no provider
// mounts here — hand back the demo balances instead.
vi.mock('@/features/wallet/useWalletBalances', () => ({
  useWalletBalances: () => ({ balances: { sol: 4.218, usdc: 1842.5 }, loading: false }),
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

/* ── Notification settings → feed ─────────────────────────────────────────── */

describe('notification settings', () => {
  it('turning push off empties the notification feed', async () => {
    const screen = await render(
      <SettingsProvider>
        <NotificationsProvider>
          <NotificationSettingsScreen />
          <NotificationsSheet visible onClose={() => {}} />
        </NotificationsProvider>
      </SettingsProvider>,
    )

    expect(screen.getByText('Escrow funded')).toBeTruthy()

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

describe('export farm record', () => {
  it('previews the CSV and copies it to the clipboard', async () => {
    const screen = await render(<ExportSettingsScreen />)

    // Header visible in the preview + the row count matches the builder.
    await screen.findByText(/record_type,farm_name/, {}, LOAD)
    expect(screen.getByText(new RegExp(`^${farmRecordRowCount()} rows`))).toBeTruthy()

    fireEvent.press(screen.getByLabelText('Copy CSV'))
    expect(Clipboard.setString).toHaveBeenCalledWith(expect.stringContaining('Clearwater Ridge Farm'))
  })

  it('writes the file and hands it to the share sheet', async () => {
    const screen = await render(<ExportSettingsScreen />)

    fireEvent.press(screen.getByLabelText('Share .csv file'))

    await waitFor(() => {
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        expect.stringMatching(/\.csv$/),
        expect.objectContaining({ mimeType: 'text/csv' }),
      )
    })
    expect(screen.queryByText('Could not share the file')).toBeNull()
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
    const screen = await renderProfile(<ProfileScreen />)

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
