/**
 * useConfigQuery — reads the on-chain `config` PDA (the authority roles).
 *
 * This is the primitive the admin console's gating hangs off: the Settings
 * entry renders only when the connected wallet equals `config.admin`, and
 * the console itself re-checks the same value. Both are UX — the program
 * re-verifies the role on every gated instruction regardless.
 */

import { useQuery } from '@tanstack/react-query'
import { configPda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'

/** Decoded shape of the on-chain `Config` account (camelCase, base58 keys). */
export interface ConfigRoles {
  admin: string
  /** Vestigial after Phase 1 — kept for layout, gates nothing. */
  verifier: string
  /** Vestigial after Phase 2 — kept for layout, gates nothing. */
  oracle: string
  bump: number
}

export interface ConfigQueryResult {
  config: ConfigRoles | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useConfigQuery(): ConfigQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()

  const query = useQuery({
    queryKey: ['indorse', 'config', url],
    retry: 1,
    queryFn: async () => {
      const addr = await configPda()
      return fetchAccount<ConfigRoles>(rpc, addr, 'Config')
    },
  })

  return {
    config: query.data ?? null,
    state: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
