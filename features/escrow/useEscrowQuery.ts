/**
 * useEscrowQuery — reads the most-recent (highest-index) harvest batch's
 * escrow for the connected wallet's farm.
 *
 * Strategy: derive batch PDAs for indices 0..batchCount-1, batch-fetch all
 * HarvestBatch accounts, then derive and batch-fetch every Escrow.  Returns
 * the first funded escrow found, or the last non-null one if none are funded.
 * Disabled when batchCount is 0.
 */

import { useQuery } from '@tanstack/react-query'
import { batchPda, escrowPda, fetchAccounts, useProgramRpc, useRpcUrl } from '@/lib/program'
import { parseEscrowState } from './types'
import type { Escrow } from './types'
import type { HarvestBatch } from '@/features/harvest/types'

export interface EscrowQueryResult {
  escrow: Escrow | null
  escrowAddress: string | null
  batchAddress: string | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useEscrowQuery(target: { farmAddress: string; batchCount: number } | null): EscrowQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const enabled = !!target && target.batchCount > 0

  const query = useQuery({
    queryKey: ['indorse', 'escrow', url, target?.farmAddress ?? null, target?.batchCount ?? 0],
    enabled,
    retry: 1,
    queryFn: async () => {
      if (!target) return null
      const { farmAddress, batchCount } = target

      // Derive all batch PDAs (0-indexed).
      const batchAddresses = await Promise.all(Array.from({ length: batchCount }, (_, i) => batchPda(farmAddress, i)))

      // Fetch all batch accounts so we can confirm they exist.
      const batches = await fetchAccounts<HarvestBatch>(rpc, batchAddresses, 'HarvestBatch')

      // Derive escrow PDA for every batch that has an account.
      const escrowAddresses = await Promise.all(batchAddresses.map((addr) => escrowPda(addr)))

      // Fetch all escrow accounts.
      const escrows = await fetchAccounts<Escrow>(rpc, escrowAddresses, 'Escrow')

      // Pick the first funded escrow, or the last non-null one.
      let best: { escrow: Escrow; escrowAddress: string; batchAddress: string } | null = null
      for (let i = 0; i < escrows.length; i++) {
        const e = escrows[i]
        if (!e) continue
        void batches[i] // accessed only to confirm type alignment
        const parsed: Escrow = { ...e, state: parseEscrowState(e.state) }
        if (!best || parsed.state === 'funded') {
          best = {
            escrow: parsed,
            escrowAddress: escrowAddresses[i],
            batchAddress: batchAddresses[i],
          }
        }
        if (parsed.state === 'funded') break
      }
      return best
    },
  })

  return {
    escrow: query.data?.escrow ?? null,
    escrowAddress: query.data?.escrowAddress ?? null,
    batchAddress: query.data?.batchAddress ?? null,
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
