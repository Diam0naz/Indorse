/**
 * Reward vault discovery — the one part of a `reward_report` claim that
 * reads the chain rather than deriving from it.
 *
 * `reward_vault` is a plain token account, not an associated one, and
 * `reward_mint` is whichever mint the admin funded — neither can be derived
 * locally and neither is a field on `Config`. The authority's token accounts
 * are the only source: that account *is* the vault, and its `mint` field is
 * what the instruction needs. Asserted here because it is the piece that
 * fails farthest from the reason it failed — an empty set must say so
 * before a wallet prompt, not as an opaque token error afterwards.
 */

import { describe, expect, it, vi } from 'vitest'
import { address } from '@solana/kit'
import { resolveReward } from './useRewardReport'
import type { ProgramRpc } from '@/lib/program'

const AUTHORITY = address('DTxRkCpM2Nyt4Q5JLesBvwQ6NpWzw8ZDso24UHBHTRwM')
const VAULT = address('6a9b6oLfzGwJzF9Rg352MQXPe1Dbm6k9LdvjR7UKYncz')
const MINT = address('Cb59pZAmLRCtd9FhsLbGF1hYKQpLtRuVXHRScwSp2fC6')

/** The `getTokenAccountsByOwner` slice the discovery actually consumes. */
function rpcWith(accounts: unknown[]): ProgramRpc {
  return {
    getTokenAccountsByOwner: vi.fn(() => ({ send: async () => ({ value: accounts }) })),
  } as unknown as ProgramRpc
}

function tokenAccount(pubkey: typeof VAULT, mint: typeof MINT) {
  return { pubkey, account: { data: { parsed: { info: { mint } } } } }
}

describe('reward vault discovery', () => {
  it('takes the authority token account as the vault and the mint it names', async () => {
    await expect(resolveReward(rpcWith([tokenAccount(VAULT, MINT)]), AUTHORITY)).resolves.toEqual({
      vault: VAULT,
      mint: MINT,
    })
  })

  it('names a missing vault instead of failing later at the token program', async () => {
    await expect(resolveReward(rpcWith([]), AUTHORITY)).rejects.toThrow(/not funded/)
  })
})
