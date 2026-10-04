/**
 * useHarvestQuery — reads a farm's harvest batches from the chain.
 *
 * Derives batch PDAs for indices 0..batchCount-1, fetches them in one
 * getMultipleAccounts round trip and returns them newest-first. Disabled when
 * there is no farm or `batchCount` is zero — in that case the result is
 * `ready` with an empty list, so screens can treat "no batches" uniformly.
 *
 * The read side of `useSubmitHarvest`; `useEscrowQuery` covers the escrow
 * attached to a batch, this hook covers the batches themselves (crop,
 * quantity, harvest-time provenance counts).
 */

import { useQuery } from '@tanstack/react-query'
import { batchPda, fetchAccounts, useProgramRpc, useRpcUrl } from '@/lib/program'
import type { HarvestBatch } from './types'

/** A decoded harvest batch plus its on-chain address. */
export type ChainHarvestBatch = HarvestBatch & { address: string }

export interface HarvestQueryResult {
  batches: ChainHarvestBatch[]
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useHarvestQuery(target: { farmAddress: string; batchCount: number } | null): HarvestQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const count = target?.batchCount ?? 0
  const enabled = !!target && count > 0

  const query = useQuery({
    queryKey: ['indorse', 'harvest', url, target?.farmAddress ?? null, count],
    enabled,
    retry: 1,
    queryFn: async () => {
      const farm = target
      if (!farm) return []
      const addresses = await Promise.all(
        Array.from({ length: count }, (_, index) => batchPda(farm.farmAddress, index)),
      )
      const rows = await fetchAccounts<HarvestBatch>(rpc, addresses, 'HarvestBatch')
      const batches: ChainHarvestBatch[] = []
      rows.forEach((row, i) => {
        if (row) batches.push({ ...row, address: addresses[i] })
      })
      batches.sort((a, b) => b.index - a.index)
      return batches
    },
  })

  return {
    batches: query.data ?? [],
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
