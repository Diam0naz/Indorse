/**
 * useReportsQuery — reads every scout report of a farm from the chain.
 *
 * Derives the report PDAs (["report", farm, index] for index 0..count-1),
 * fetches them in one `getMultipleAccounts` round trip and returns them
 * newest-first. Disabled when there is no farm or `reportCount` is zero —
 * in that case the result is `ready` with an empty list, so screens can treat
 * "no reports" uniformly.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchAccounts, reportPda, useProgramRpc, useRpcUrl } from '@/lib/program'
import type { ScoutReport } from './types'

/** A decoded report plus its on-chain address (id of the log row). */
export type ChainReport = ScoutReport & { address: string }

export interface ReportsQueryResult {
  reports: ChainReport[]
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useReportsQuery(target: { address: string; reportCount: number } | null): ReportsQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const count = target?.reportCount ?? 0
  const enabled = !!target && count > 0

  const query = useQuery({
    queryKey: ['indorse', 'reports', url, target?.address ?? null, count],
    enabled,
    retry: 1,
    queryFn: async () => {
      const farm = target
      if (!farm) return []
      const addresses = await Promise.all(Array.from({ length: count }, (_, index) => reportPda(farm.address, index)))
      const rows = await fetchAccounts<ScoutReport>(rpc, addresses, 'ScoutReport')
      const reports: ChainReport[] = []
      rows.forEach((row, i) => {
        if (row) reports.push({ ...row, address: addresses[i] })
      })
      reports.sort((a, b) => b.index - a.index)
      return reports
    },
  })

  return {
    reports: query.data ?? [],
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
