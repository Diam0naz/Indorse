/**
 * useMobileWalletSetup
 *
 * Thin wrapper around `useMobileWallet` from @wallet-ui/react-native-kit that:
 *  - Exposes a friendly `walletState` enum so components don't have to
 *    null-check `account` themselves.
 *  - Provides a single `toggleConnection` helper so the UI just calls one
 *    function regardless of whether the wallet is connected or not.
 *  - Tracks connection errors so they can be surfaced in the UI.
 *
 * Must be rendered below <MobileWalletProvider> (already set up in
 * components/app-providers.tsx).
 */

import { useState, useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import type { WalletConnectionState } from './types'

export interface UseMobileWalletSetupResult {
  /** The full useMobileWallet result — use for rpc calls, signing, etc. */
  wallet: ReturnType<typeof useMobileWallet>
  /** Friendly connection state for UI rendering */
  walletState: WalletConnectionState
  /** The connected wallet address (base-58), or null when disconnected */
  address: string | null
  /** Call this to connect or disconnect */
  toggleConnection: () => Promise<void>
  /** Any error from the last connection attempt */
  error: string | null
  /** Clear a stale error */
  clearError: () => void
}

export function useMobileWalletSetup(): UseMobileWalletSetupResult {
  const wallet = useMobileWallet()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleConnection = useCallback(async () => {
    if (connecting) return
    setError(null)
    setConnecting(true)
    try {
      if (wallet.account) {
        await wallet.disconnect()
      } else {
        await wallet.connect()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setConnecting(false)
    }
  }, [connecting, wallet])

  const address = wallet.account?.address ?? null

  const walletState: WalletConnectionState = error
    ? 'error'
    : connecting
      ? 'connecting'
      : wallet.account
        ? 'connected'
        : 'disconnected'

  return {
    wallet,
    walletState,
    address,
    toggleConnection,
    error,
    clearError: () => setError(null),
  }
}
