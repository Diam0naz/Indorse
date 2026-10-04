/**
 * useFarmQuery — reads the connected wallet's farm PDA from the chain.
 *
 * Disabled until a wallet is connected (the PDA seed is the owner address).
 * `state` maps the TanStack query onto the screen's loading/error/ready
 * contract; a successful read with no account means "not registered yet"
 * (`farm: null`, ready) — the trigger for the register-farm empty state.
 */

import { useQuery } from '@tanstack/react-query'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { farmPda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'
import type { Farm } from './types'

export interface FarmQueryResult {
  /** The decoded farm account, or null when the wallet has not registered one. */
  farm: Farm | null
  /** Derived farm PDA — available whenever the read succeeded, even if empty. */
  farmAddress: string | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useFarmQuery(): FarmQueryResult {
  const { address } = useMobileWalletSetup()
  const rpc = useProgramRpc()
  const url = useRpcUrl()

  const query = useQuery({
    queryKey: ['indorse', 'farm', url, address ?? null],
    enabled: !!address,
    retry: 1,
    queryFn: async () => {
      const owner = address
      if (!owner) throw new Error('Wallet is not connected.')
      const farmAddress = await farmPda(owner)
      const farm = await fetchAccount<Farm>(rpc, farmAddress, 'Farm')
      return { farmAddress, farm: farm ? { ...farm, address: farmAddress } : null }
    },
  })

  return {
    farm: query.data?.farm ?? null,
    farmAddress: query.data?.farmAddress ?? null,
    state: !address ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
