/**
 * usePolicyQuery — reads the most-recent parametric insurance policy for
 * the connected wallet's farm (index = policyCount - 1).
 *
 * Disabled when policyCount is 0 (no policies yet).
 */

import { useQuery } from '@tanstack/react-query'
import { policyPda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'
import { parsePolicyState } from './types'
import type { Policy } from './types'

export interface PolicyQueryResult {
  policy: Policy | null
  policyAddress: string | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function usePolicyQuery(target: { farmAddress: string; policyCount: number } | null): PolicyQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const enabled = !!target && target.policyCount > 0

  const query = useQuery({
    queryKey: ['indorse', 'policy', url, target?.farmAddress ?? null, target?.policyCount ?? 0],
    enabled,
    retry: 1,
    queryFn: async () => {
      if (!target) return null
      const { farmAddress, policyCount } = target
      // Policies are 0-indexed; the most-recent is at policyCount - 1.
      const addr = await policyPda(farmAddress, policyCount - 1)
      const policy = await fetchAccount<Policy>(rpc, addr, 'Policy')
      if (!policy) return null
      return {
        policy: { ...policy, state: parsePolicyState(policy.state), address: addr },
        policyAddress: addr,
      }
    },
  })

  return {
    policy: query.data?.policy ?? null,
    policyAddress: query.data?.policyAddress ?? null,
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
