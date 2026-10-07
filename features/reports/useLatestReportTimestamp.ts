/**
 * useLatestReportTimestamp — when a farm was last reported on.
 *
 * The Discover sheet's recency signal. `docs/discovery.md` recorded this as
 * a known edge — "report timestamps would require reading every report
 * account per farm" — but the sheet needs only ONE report, and the seeds make
 * it free: reports are `["report", farm, u32(index)]` and the Farm account
 * already carries `reportCount` (the directory row ships it), so the newest
 * report is the account at `reportCount - 1`. One `getAccountInfo`, no scan,
 * and no extra round trip even for the count itself.
 *
 * Staleness can only point the same way: a directory row a few seconds old
 * has an *undercounted* `reportCount`, which resolves to a report that
 * certainly exists — at worst slightly older than the true newest. It can
 * never invent an address that is not on chain.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchAccount, reportPda, useProgramRpc, useRpcUrl, type ProgramRpc } from '@/lib/program'
import type { ScoutReport } from './types'

/** A farm as this read needs it — the same shape the directory ships. */
export interface DatedFarm {
  address: string
  reportCount: number
}

/**
 * The read itself, exposed bare so it can be asserted against a stubbed RPC
 * the way `resolveReward` is. The one line worth protecting is the index:
 * `reportCount - 1` is the newest *existing* report, and `reportCount` is the
 * next one to be written — a single `+1` off and this would date the wrong
 * account, or ask for one nobody has written yet.
 *
 * Returns `null` for "no reports" and "not on chain" alike: the sheet has no
 * date to show in either case, and it says so rather than guessing.
 */
export async function fetchLatestReportTimestamp(rpc: ProgramRpc, farm: DatedFarm): Promise<number | null> {
  // Guarded here as well as in the hook's `enabled`: a caller deriving
  // index -1 would send a seed no instruction ever wrote.
  if (farm.reportCount <= 0) return null
  const newest = await reportPda(farm.address, farm.reportCount - 1)
  const report = await fetchAccount<ScoutReport>(rpc, newest, 'ScoutReport')
  return report ? report.timestamp : null
}

export interface LatestReportResult {
  /** Unix seconds of the newest report; `null` when unknown or unfetchable. */
  timestamp: number | null
  /** `'idle'` when there is nothing to ask (no farm, or no reports yet). */
  state: 'idle' | 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useLatestReportTimestamp(target: DatedFarm | null): LatestReportResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const count = target?.reportCount ?? 0
  const enabled = !!target && count > 0

  const query = useQuery({
    queryKey: ['indorse', 'latest-report', url, target?.address ?? null, count],
    enabled,
    retry: 1,
    queryFn: async () => {
      if (!target) return null
      return fetchLatestReportTimestamp(rpc, target)
    },
  })

  return {
    timestamp: query.data ?? null,
    state: !enabled ? 'idle' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
