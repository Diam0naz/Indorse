/**
 * features/wallet/useWalletBalances.ts
 *
 * Fetches SOL and USDC balances for the connected wallet address.
 * Uses the Kit RPC client from useMobileWallet().
 *
 * USDC mint addresses:
 *   mainnet  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 *   devnet   4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
 */

import { useQuery } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'

export interface WalletBalances {
  sol: number
  usdc: number
}

export function useWalletBalances(walletAddress: string | null | undefined): {
  balances: WalletBalances
  loading: boolean
} {
  const { client } = useMobileWallet()
  const { network } = useSettings()
  const usdcMint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET

  const query = useQuery({
    queryKey: ['wallet-balances', walletAddress, network.cluster],
    enabled: !!walletAddress && !!client,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      if (!walletAddress || !client) return { sol: 0, usdc: 0 }

      const addr = toAddress(walletAddress)

      // SOL balance
      const solResult = await client.rpc.getBalance(addr).send()
      const sol = Number(solResult.value) / 1e9

      // USDC SPL token balance
      let usdc = 0
      try {
        const tokenResult = await client.rpc
          .getTokenAccountsByOwner(addr, { mint: toAddress(usdcMint) }, { encoding: 'jsonParsed' })
          .send()
        const first = tokenResult.value[0]
        if (first) {
          const info = (
            first.account.data as unknown as {
              parsed: { info: { tokenAmount: { uiAmount: number } } }
            }
          ).parsed.info
          usdc = info.tokenAmount.uiAmount ?? 0
        }
      } catch {
        // No token account = 0 USDC, not an error
      }

      return { sol, usdc }
    },
  })

  return {
    balances: query.data ?? { sol: 0, usdc: 0 },
    loading: query.isPending,
  }
}
