/**
 * useUsdcBalanceQuery — USDC balance of an arbitrary token account address.
 *
 * Unlike `useWalletBalances` (owner → token-accounts-by-owner, needs the
 * wallet client), this reads ONE known account — the program treasury's ATA,
 * a policy vault PDA, the verifier set's bond vault — through the plain
 * program RPC, so it works for PDA-owned accounts and while disconnected.
 *
 * `balance` is `null` when the account does not exist at all (the console
 * reads that as "never funded" — the pre-demo solvency signal), and a number
 * (0 included) once it does.
 */

import { useQuery } from '@tanstack/react-query'
import { getBase64Encoder, type Address } from '@solana/kit'
import { useProgramRpc, useRpcUrl, type ProgramRpc } from '@/lib/program'

/**
 * Balance (UI units, 6 decimals) of one token account, read straight from
 * the base account layout: `[disc(8) mint(32) owner(32) amount(8) …]`.
 * Returns `null` when the account does not exist.
 *
 * Deliberately manual — no @solana/spl-token dependency, and a missing
 * account is a normal "unfunded" answer rather than an RPC error.
 */
export async function fetchTokenAccountBalance(rpc: ProgramRpc, accountAddress: string): Promise<number | null> {
  const res = await rpc
    .getAccountInfo(accountAddress as Address, {
      encoding: 'base64',
      commitment: 'confirmed',
    })
    .send()
  if (!res.value) return null
  const bytes = getBase64Encoder().encode(res.value.data[0])
  if (bytes.length < 80) return null // not an SPL token account layout
  const amount = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getBigUint64(72, true)
  return Number(amount) / 1e6
}

export interface UsdcBalanceQueryResult {
  /** `null` = the token account does not exist yet (never funded). */
  balance: number | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useUsdcBalanceQuery(accountAddress: string | null): UsdcBalanceQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const enabled = !!accountAddress

  const query = useQuery({
    queryKey: ['indorse', 'usdc-balance', url, accountAddress ?? null],
    enabled,
    retry: 1,
    queryFn: async () => {
      if (!accountAddress) return null
      return fetchTokenAccountBalance(rpc, accountAddress)
    },
  })

  return {
    balance: query.data ?? null,
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
