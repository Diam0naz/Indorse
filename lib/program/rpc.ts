/**
 * lib/program/rpc.ts — Account reads over kit's JSON-RPC client.
 *
 * `fetchAccount` pulls one account (base64), verifies the 8-byte discriminator
 * and decodes it with the IDL-driven codec; `fetchAccounts` batches up to 100
 * addresses per call (the RPC limit) and returns entries positionally with
 * `null` for missing accounts.
 *
 * Reads go through plain `fetch`, so tests stub `fetch` and nothing else.
 */

import {
  createSolanaRpc,
  getBase64Encoder,
  type Address,
  type ReadonlyUint8Array,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit'
import { decodeAccount } from './codec'

export type ProgramRpc = Rpc<SolanaRpcApi>

/** The RPC config every read uses — confirmed reads, base64 account data. */
const READ_CONFIG = { encoding: 'base64', commitment: 'confirmed' } as const

/** Kit RPC client bound to an endpoint (devnet by default — `rpcUrl(network)`). */
export function createProgramRpc(url: string): ProgramRpc {
  return createSolanaRpc(url)
}

function base64ToBytes(data: readonly [string, string]): ReadonlyUint8Array {
  return getBase64Encoder().encode(data[0])
}

/**
 * Fetch and decode a single account.
 * @returns the decoded camelCase struct, or `null` when the account does not exist.
 * @throws  on discriminator mismatch (address holds a different account type).
 */
export async function fetchAccount<T = Record<string, unknown>>(
  rpc: ProgramRpc,
  accountAddress: string,
  accountName: string,
): Promise<T | null> {
  const res = await rpc.getAccountInfo(accountAddress as Address, READ_CONFIG).send()
  if (!res.value) return null
  return decodeAccount<T>(base64ToBytes(res.value.data), accountName)
}

/**
 * Fetch and decode many accounts in a single `getMultipleAccounts` round trip
 * (chunked to the RPC's 100-address limit). Missing accounts come back `null`
 * in their original position, so index N still matches input address N.
 */
export async function fetchAccounts<T = Record<string, unknown>>(
  rpc: ProgramRpc,
  addresses: string[],
  accountName: string,
): Promise<(T | null)[]> {
  const out: (T | null)[] = []
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100)
    const res = await rpc.getMultipleAccounts(chunk as Address[], READ_CONFIG).send()
    for (const value of res.value) {
      out.push(value ? decodeAccount<T>(base64ToBytes(value.data), accountName) : null)
    }
  }
  return out
}
