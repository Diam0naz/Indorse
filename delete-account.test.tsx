/**
 * delete-account.test.tsx — Settings → Account & local data
 *
 * The app has no server-side account; "delete account" is the local wipe.
 * The screen must (a) say honestly what it erases and that on-chain records
 * are untouched, (b) drive every store through its own provider reset, and
 * (c) disconnect the wallet only when one is connected. Each provider is
 * stubbed at the hook level — this file covers the screen's wiring, and the
 * provider resets themselves are pinned in their own test files.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import AccountSettingsScreen from '@/app/settings/account'

const stores = vi.hoisted(() => ({
  resetSettings: vi.fn(),
  resetAuth: vi.fn(async () => undefined),
  clearProfile: vi.fn(),
  resetRegistry: vi.fn(),
  clearNotifications: vi.fn(),
}))

const walletSetup = vi.hoisted(() => ({
  walletState: 'connected' as string,
  toggleConnection: vi.fn(async () => undefined),
}))

// settings-ui routes through the imperative navigation API only.
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('react-native-safe-area-context', async () => {
  const { View } = await import('react-native')
  return {
    useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
    SafeAreaView: View,
  }
})

vi.mock('@/components/settings-provider', () => ({
  useSettings: () => ({ reset: stores.resetSettings }),
}))

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ reset: stores.resetAuth }),
}))

vi.mock('@/components/profile-provider', () => ({
  useProfile: () => ({ clearProfile: stores.clearProfile }),
}))

vi.mock('@/components/farm-registry-provider', () => ({
  useFarmRegistry: () => ({ reset: stores.resetRegistry }),
}))

vi.mock('@/components/notifications', () => ({
  useNotifications: () => ({ clear: stores.clearNotifications }),
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: walletSetup.walletState,
    address: null,
    toggleConnection: walletSetup.toggleConnection,
    error: null,
    clearError: vi.fn(),
  }),
}))

const LOAD = { timeout: 3000 }

function renderScreen() {
  return render(<AccountSettingsScreen />)
}

function expectAllStoresReset() {
  expect(stores.resetSettings).toHaveBeenCalledTimes(1)
  expect(stores.resetRegistry).toHaveBeenCalledTimes(1)
  expect(stores.clearProfile).toHaveBeenCalledTimes(1)
  expect(stores.clearNotifications).toHaveBeenCalledTimes(1)
  expect(stores.resetAuth).toHaveBeenCalledTimes(1)
}

beforeEach(() => {
  walletSetup.walletState = 'connected'
  for (const fn of Object.values(stores)) fn.mockClear()
  walletSetup.toggleConnection.mockClear()
})

afterEach(() => {
  walletSetup.walletState = 'connected'
})

describe('account & local data', () => {
  it('spells out the wipe scope and that on-chain records are untouched', async () => {
    const screen = await renderScreen()

    await screen.findByText('What gets erased', {}, LOAD)
    expect(screen.getByText('Farm registry')).toBeTruthy()
    expect(screen.getByText('Operator profile')).toBeTruthy()
    expect(screen.getByText('Device verification')).toBeTruthy()
    expect(screen.getByText('Wallet session')).toBeTruthy()
    await screen.findByText(
      'On-chain records — farms, scout reports, harvest batches, escrows and policies — live on Solana and are not touched by this.',
      {},
      LOAD,
    )
  })

  it('erases every store and disconnects the connected wallet', async () => {
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByLabelText('Erase local data', {}, LOAD))
    await screen.findByText('Erase everything stored on this device?', {}, LOAD)
    await fireEvent.press(screen.getByTestId('delete-account-confirm'))

    await waitFor(expectAllStoresReset, LOAD)
    await waitFor(() => expect(walletSetup.toggleConnection).toHaveBeenCalledTimes(1), LOAD)
    await screen.findByText('Local data erased. On-chain records were not touched.', {}, LOAD)
  })

  it('still wipes everything for a guest — there is no wallet to disconnect', async () => {
    walletSetup.walletState = 'disconnected'
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByLabelText('Erase local data', {}, LOAD))
    await screen.findByText('Erase everything stored on this device?', {}, LOAD)
    await fireEvent.press(screen.getByTestId('delete-account-confirm'))

    await waitFor(expectAllStoresReset, LOAD)
    expect(walletSetup.toggleConnection).not.toHaveBeenCalled()
    await screen.findByText('Local data erased. On-chain records were not touched.', {}, LOAD)
  })
})
