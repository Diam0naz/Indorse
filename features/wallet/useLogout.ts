/**
 * features/wallet/useLogout.ts — end the session completely
 *
 * One action, two effects: the wallet disconnects first (nothing can sign
 * afterwards), then the app re-arms its passcode/biometric gate. Unlike the
 * plain disconnect affordances (Wallet & Security's button, the Profile
 * card's link button), logging out means credentials are required to come
 * back.
 *
 * `available` is false only when there is nothing to end — already
 * disconnected AND no passcode registered (lock() would be a no-op anyway).
 */

import { useAuth } from '@/components/auth-provider'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'

export function useLogout() {
  const { walletState, toggleConnection } = useMobileWalletSetup()
  const { status, lock } = useAuth()

  const connected = walletState === 'connected'
  const busy = walletState === 'connecting'
  const available = connected || status !== 'unregistered'

  /** Disconnect, then lock. A failed disconnect still locks — the intent
   *  was to end the session, not to leave an unlocked app behind. */
  async function logout() {
    if (connected) {
      try {
        await toggleConnection()
      } catch {
        // The wallet may keep its session; the app gate closes regardless.
      }
    }
    lock()
  }

  return { logout, busy, available }
}
