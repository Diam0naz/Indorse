/**
 * WalletConnectButton tests
 *
 * We mock `useMobileWalletSetup` so the tests run without a real wallet
 * adapter or blockchain connection.
 */

import { render, fireEvent } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WalletConnectButton } from '@/features/wallet/WalletConnectButton'
import { walletName } from '@/lib/wallet-name'
import type { WalletConnectionState } from '@/features/wallet/types'

const ADDRESS = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'

// ── Mock useMobileWalletSetup ────────────────────────────────────────

const mockToggle = vi.fn()
const mockSetup: {
  wallet: never
  walletState: WalletConnectionState
  address: string | null
  toggleConnection: typeof mockToggle
  error: string | null
  clearError: ReturnType<typeof vi.fn>
} = {
  wallet: {} as never,
  walletState: 'disconnected',
  address: null,
  toggleConnection: mockToggle,
  error: null,
  clearError: vi.fn(),
}

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => mockSetup,
}))

// ── Helpers ──────────────────────────────────────────────────────────

async function renderButton(overrides: Partial<typeof mockSetup> = {}) {
  Object.assign(mockSetup, overrides)
  return render(<WalletConnectButton />)
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('WalletConnectButton', () => {
  beforeEach(() => {
    mockToggle.mockReset()
    Object.assign(mockSetup, {
      wallet: {} as never,
      walletState: 'disconnected',
      address: null,
      error: null,
    })
  })

  it('renders "Connect Wallet" when disconnected', async () => {
    const screen = await renderButton()
    expect(screen.getByText('Connect Wallet')).toBeTruthy()
  })

  it('renders a friendly wallet name (never the raw address) when connected', async () => {
    const screen = await renderButton({ walletState: 'connected', address: ADDRESS })
    expect(screen.getByText(`✓ ${walletName(ADDRESS)}`)).toBeTruthy()
    expect(screen.queryByText(/GVen/)).toBeNull()
  })

  it('shows a confirmation alert naming the wallet on connect', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    // Mutate the store object in place — the button reads `wallet.account`
    // from the object it captured at render time.
    mockToggle.mockImplementation(async () => {
      Object.assign(mockSetup.wallet as unknown as object, { account: { address: ADDRESS } })
    })

    const screen = await renderButton()
    fireEvent.press(screen.getByRole('button', { name: 'Connect wallet' }))

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1))
    const [title, message] = alertSpy.mock.calls[0]
    expect(title).toBe('Wallet connected')
    expect(message).toContain(walletName(ADDRESS))
    expect(message).not.toContain('GVen')

    alertSpy.mockRestore()
  })

  it('shows "Disconnect" link when connected', async () => {
    const screen = await renderButton({
      walletState: 'connected',
      address: 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht',
    })
    expect(screen.getByText('Disconnect')).toBeTruthy()
  })

  it('does not show "Disconnect" link when disconnected', async () => {
    const screen = await renderButton()
    expect(screen.queryByText('Disconnect')).toBeNull()
  })

  it('calls toggleConnection when the main button is pressed', async () => {
    const screen = await renderButton()
    fireEvent.press(screen.getByRole('button', { name: 'Connect wallet' }))
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('is disabled (busy) while connecting', async () => {
    const screen = await renderButton({ walletState: 'connecting' })
    const btn = screen.getByRole('button', { name: 'Connect wallet' })
    expect(btn.props.accessibilityState?.busy).toBe(true)
  })

  it('renders an error message when error is set', async () => {
    const screen = await renderButton({ error: 'User rejected the request' })
    expect(screen.getByText(/User rejected/)).toBeTruthy()
  })

  it('does not render an error message when error is null', async () => {
    const screen = await renderButton()
    expect(screen.queryByText(/rejected/)).toBeNull()
  })

  it('calls toggleConnection from the Disconnect link', async () => {
    const screen = await renderButton({
      walletState: 'connected',
      address: 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht',
    })
    fireEvent.press(screen.getByText('Disconnect'))
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })
})
