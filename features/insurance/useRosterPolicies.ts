/**
 * useRosterPolicies — every chain farm in the roster, with its most-recent
 * policy, in ONE query.
 *
 * The strip needs an ordered, stable list (one entry per roster farm, in
 * registry order), which rules out a hooks-in-a-loop design: the roster
 * length changes as farms are added. So a single `useQuery` walks the
 * targets inside `queryFn` and carries a per-item outcome — including
 * `unreadable`, the honest "this farm's fetch failed" that is NOT the same
 * as "no policy".
 *
 * Each chain farm costs two reads (Farm for `policyCount`, then the
 * policy PDA at `policyCount - 1`), fanned out across farms in parallel.
 * Local-only registry entries are skipped: they have no on-chain policy
 * to show.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchAccount, policyPda, useProgramRpc, useRpcUrl } from '@/lib/program'
import { parsePolicyState } from './types'
import type { Policy } from './types'
import type { Farm } from '@/features/farm/types'
import type { FarmEntry } from '@/components/farm-registry-provider'

export interface RosterPolicyItem {
  /** Registry id — the strip's selection key. */
  farmId: string
  farmName: string
  farmAddress: string
  /** `unreadable` = the read failed (RPC) — distinct from "no policy". */
  state: 'loading' | 'ready' | 'unreadable'
  /** The farm's most-recent policy, or null when it has none. */
  policy: (Policy & { address: string }) | null
}

type ItemState = RosterPolicyItem['state']

function placeholder(farm: FarmEntry, state: ItemState): RosterPolicyItem {
  return {
    farmId: farm.id,
    farmName: farm.name,
    farmAddress: farm.address ?? '',
    state,
    policy: null,
  }
}

export function useRosterPoliciesQuery(farms: FarmEntry[]): RosterPolicyItem[] {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const targets = farms.filter((f) => f.source === 'chain' && f.address)

  const query = useQuery({
    queryKey: ['indorse', 'roster-policies', url, targets.map((f) => f.address).join(',')],
    enabled: targets.length > 0,
    retry: 1,
    queryFn: async () =>
      Promise.all(
        targets.map(async (farm): Promise<RosterPolicyItem> => {
          const address = farm.address
          if (!address) return placeholder(farm, 'unreadable')
          try {
            const account = await fetchAccount<Farm>(rpc, address, 'Farm')
            const count = account?.policyCount ?? 0
            if (count === 0) return placeholder(farm, 'ready')
            // Policies are 0-indexed; the most-recent is at policyCount - 1.
            const policyAddress = await policyPda(address, count - 1)
            const policy = await fetchAccount<Policy>(rpc, policyAddress, 'Policy')
            if (!policy) return placeholder(farm, 'unreadable')
            return {
              ...placeholder(farm, 'ready'),
              policy: { ...policy, state: parsePolicyState(policy.state), address: policyAddress },
            }
          } catch {
            return placeholder(farm, 'unreadable')
          }
        }),
      ),
  })

  // Same shape at every lifecycle stage, so the strip's order and count
  // never jump while data is in flight or after a failed refetch.
  if (query.isPending) return targets.map((farm) => placeholder(farm, 'loading'))
  if (query.isError) return targets.map((farm) => placeholder(farm, 'unreadable'))
  return query.data
}
