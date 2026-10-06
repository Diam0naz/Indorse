/**
 * features/farm/useFarmSince.ts — When did this farm first touch the chain?
 *
 * "Member since" is a fact, not a form field: the oldest signature that
 * ever mentioned the farm PDA IS the registration moment (the account is
 * created by `register_farm` and nothing before it can reference it).
 *
 * Read via `getSignaturesForAddress`, newest-first, walking pages until
 * the history is exhausted (hard cap: 10 pages — a farm that somehow
 * exceeds that renders '—' rather than a guessed date). A missing
 * blockTime on the oldest row is likewise '—': unknown stays unknown.
 */

import { useQuery } from '@tanstack/react-query'
import { useProgramRpc, useRpcUrl, toAddress } from '@/lib/program'

export interface FarmSinceResult {
  /** Unix seconds of the farm's earliest signature, or null while unknown. */
  since: number | null
  state: 'loading' | 'error' | 'ready'
  retry: () => Promise<void>
}

const PAGE_LIMIT = 1000
const MAX_PAGES = 10

export function useFarmSinceQuery(farmAddress: string | null): FarmSinceResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const enabled = !!farmAddress

  const query = useQuery({
    queryKey: ['indorse', 'farm-since', url, farmAddress],
    enabled,
    retry: 1,
    queryFn: async () => {
      if (!farmAddress) return null
      const address = toAddress(farmAddress)
      let before: string | null = null
      let oldest: number | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        const config = {
          limit: PAGE_LIMIT,
          commitment: 'confirmed',
          ...(before ? { before } : {}),
        }
        const batch = (await rpc
          .getSignaturesForAddress(address, config as Parameters<typeof rpc.getSignaturesForAddress>[1])
          .send()) as ReadonlyArray<{ signature: string; blockTime: bigint | null }>
        if (batch.length === 0) break
        // The last row of the final page is the oldest signature overall.
        const blockTime = batch[batch.length - 1].blockTime
        oldest = blockTime === null ? null : Number(blockTime)
        if (batch.length < PAGE_LIMIT) break
        before = batch[batch.length - 1].signature
        if (page === MAX_PAGES - 1) return null // history not exhausted — unknown
      }
      return oldest
    },
  })

  return {
    since: query.data ?? null,
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: async () => {
      await query.refetch()
    },
  }
}
