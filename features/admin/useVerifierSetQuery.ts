/**
 * useVerifierSetQuery — reads the Phase 1 K-of-N verifier set
 * (`["verifier_set"]`: quorum k, seat price, bonded members).
 *
 * `set` is `null` when the account does not exist yet — the console then
 * offers `init_verifier_set` instead of the governance actions.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchAccount, useProgramRpc, useRpcUrl, verifierSetPda } from '@/lib/program'

export interface VerifierMember {
  pubkey: string
  /** Exact stake posted at join time (e6 USDC). */
  stake: number
}

export interface VerifierSetState {
  k: number
  /** Price of a NEW seat (e6 USDC) — repricing affects future joins only. */
  bondAmount: number
  members: VerifierMember[]
  bump: number
}

export interface VerifierSetQueryResult {
  set: VerifierSetState | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useVerifierSetQuery(): VerifierSetQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()

  const query = useQuery({
    queryKey: ['indorse', 'verifier-set', url],
    retry: 1,
    queryFn: async () => {
      const addr = await verifierSetPda()
      return fetchAccount<VerifierSetState>(rpc, addr, 'VerifierSet')
    },
  })

  return {
    set: query.data ?? null,
    state: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
