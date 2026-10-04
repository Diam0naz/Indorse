/**
 * WalletConnectButton
 *
 * A self-contained button that shows the wallet connection state and lets the
 * user connect / disconnect with a single tap.
 *
 * On connect we show a friendly confirmation alert and use a stable two-word
 * name derived from the address (see lib/wallet-name) instead of the raw
 * base58 pubkey — long strings of characters read as "something technical and
 * possibly dangerous" to first-time users.
 *
 * Props:
 *  - onConnected: optional callback fired when a wallet is successfully connected,
 *    receives the wallet address.
 */

import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'
import { useMobileWalletSetup } from './useMobileWalletSetup'
import { useTheme } from '@/components/theme-provider'
import { walletName } from '@/lib/wallet-name'
import { useT } from '@/lib/i18n'

interface WalletConnectButtonProps {
  onConnected?: (address: string) => void
}

export function WalletConnectButton({ onConnected }: WalletConnectButtonProps) {
  const { wallet, walletState, address, toggleConnection, error } = useMobileWalletSetup()
  const { colors } = useTheme()
  const t = useT()

  const isConnected = walletState === 'connected'
  const isConnecting = walletState === 'connecting'

  // "Amber Falcon" — stable per address, no pubkey on screen.
  const name = walletName(address)

  async function handlePress() {
    const wasConnected = isConnected
    await toggleConnection()
    // Read the address from the wallet store (fresh value) instead of the
    // render-time closure, which is stale after the awaited state change.
    const newAddress = wallet.account?.address ?? null
    if (!wasConnected && newAddress) {
      Alert.alert(t('wallet.connected'), t('wallet.connectedBody', { name: walletName(newAddress) }))
      onConnected?.(newAddress)
    }
  }

  return (
    <View className="items-center gap-2">
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isConnected ? 'Disconnect wallet' : 'Connect wallet'}
        accessibilityState={{ busy: isConnecting }}
        disabled={isConnecting}
        onPress={handlePress}
        className={[
          'flex-row items-center justify-center rounded-xl px-6 py-3 min-w-[180px]',
          // Amber = the action; emerald = the confirmed, connected state.
          isConnected ? 'bg-accent active:opacity-90' : 'bg-primary active:bg-primary-hover',
          isConnecting ? 'opacity-60' : 'opacity-100',
        ].join(' ')}
      >
        {isConnecting ? (
          <ActivityIndicator color={colors.surface} size="small" />
        ) : (
          <Text className="font-sans text-surface font-semibold text-base">
            {isConnected && address ? `✓ ${name}` : t('wallet.connect')}
          </Text>
        )}
      </TouchableOpacity>

      {error ? (
        <Text className="font-sans text-danger text-xs text-center px-4" numberOfLines={2}>
          {error}
        </Text>
      ) : null}

      {isConnected ? (
        <TouchableOpacity onPress={toggleConnection}>
          <Text className="font-sans text-ink-muted text-xs underline">{t('wallet.disconnect')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}
