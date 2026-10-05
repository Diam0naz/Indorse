/**
 * useOracleSetQuery — reads the Phase 2 reader set
 * (`["oracle_set"]`: odd quorum k + member seats, no bonds).
 *
 * `set` is `null` when the account does not exist yet — the console then
 * offers `init_oracle_set` instead of seat management.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchAccount, useProgramRpc, useRpcUrl, oracleSetPda } from '@/lib/program'

export interface OracleSetState {
  /** Odd, 3..=7 — readings needed to freeze the median. */
  k: number
  members: string[]
  bump: number
}

export interface OracleSetQueryResult {
  set: OracleSetState | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useOracleSetQuery(): OracleSetQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()

  const query = useQuery({
    queryKey: ['indorse', 'oracle-set', url],
    retry: 1,
    queryFn: async () => {
      const addr = await oracleSetPda()
      return fetchAccount<OracleSetState>(rpc, addr, 'OracleSet')
    },
  })

  return {
    set: query.data ?? null,
    state: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
