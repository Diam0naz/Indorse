/**
 * useFarmQuery — reads the connected wallet's farm PDA from the chain.
 *
 * Disabled until a wallet is connected. Which farm? The roster decides:
 * a chain farm selected in the registry pill is read at its own address,
 * so every screen below (reports, policy, oracle, outbox) follows the
 * farm being featured — per-farm scoping for free. Otherwise the wallet's
 * first farm (slot 0) is derived, which is exactly what a fresh wallet —
 * and every test's default context, which reports no selection — saw
 * before multi-farm existed.
 *
 * A selected entry belonging to ANOTHER wallet (the registry is
 * device-scoped, not wallet-scoped) is refused after the fetch and the
 * read falls back to this wallet's own slot 0: one extra RPC only in the
 * mismatch case, and never another wallet's data presented as mine.
 *
 * `state` maps the TanStack query onto the screen's loading/error/ready
 * contract; a successful read with no account means "not registered yet"
 * (`farm: null`, ready) — the trigger for the register-farm empty state.
 */

import { useQuery } from '@tanstack/react-query'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { farmPda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'
import type { Farm } from './types'

export interface FarmQueryResult {
  /** The decoded farm account, or null when the wallet has not registered one. */
  farm: Farm | null
  /** Derived farm PDA — available whenever the read succeeded, even if empty. */
  farmAddress: string | null
  state: 'loading' | 'error' | 'ready'
  /** True while a background refetch runs — drives the pull-to-refresh spinner. */
  isFetching: boolean
  retry: () => void
}

export function useFarmQuery(): FarmQueryResult {
  const { address } = useMobileWalletSetup()
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  // The registry's selection — only chain farms carry a readable address.
  const registry = useFarmRegistry()
  const selectedAddress =
    registry.current && registry.current.source === 'chain' && registry.current.address
      ? registry.current.address
      : null

  const query = useQuery({
    queryKey: ['indorse', 'farm', url, address ?? null, selectedAddress ?? 'slot0'],
    enabled: !!address,
    retry: 1,
    queryFn: async () => {
      const owner = address
      if (!owner) throw new Error('Wallet is not connected.')

      if (selectedAddress) {
        const selected = await fetchAccount<Farm>(rpc, selectedAddress, 'Farm')
        if (selected && selected.owner === owner) {
          return { farmAddress: selectedAddress, farm: { ...selected, address: selectedAddress } }
        }
        // Stale entry or another wallet's farm — fall through to my own.
      }

      const farmAddress = await farmPda(owner, 0)
      const farm = await fetchAccount<Farm>(rpc, farmAddress, 'Farm')
      return { farmAddress, farm: farm ? { ...farm, address: farmAddress } : null }
    },
  })

  return {
    farm: query.data?.farm ?? null,
    farmAddress: query.data?.farmAddress ?? null,
    state: !address ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    isFetching: query.isFetching,
    retry: query.refetch,
  }
}
