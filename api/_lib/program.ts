/**
 * api/_lib/program.ts — minimal program RPC for serverless functions
 *
 * Uses plain HTTP RPC instead of @solana/kit to avoid ESM issues.
 * Keep in sync when the source changes.
 */

import { PublicKey } from './sgt'

/** The RPC config every read uses — confirmed reads, base64 account data. */
const READ_CONFIG = { encoding: 'base64', commitment: 'confirmed' } as const

/** Kit RPC client bound to an endpoint — plain HTTP version. */
export async function createProgramRpc(url: string) {
  return url
}

/** Decode base64 to Buffer */
function base64ToBuffer(data: readonly [string, string]): Buffer {
  return Buffer.from(data[0], 'base64')
}

/** Minimal Farm account decoder - just what the directory needs */
interface FarmAccount {
  name: string
  latE6: number
  lngE6: number
  owner: string
  reportCount: number
  verifiedReportCount: number
  batchCount: number
  policyCount: number
}

/** Fetch and decode a single Farm account. */
export async function fetchAccount(rpcUrl: string, accountAddress: string): Promise<FarmAccount | null> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [accountAddress, READ_CONFIG],
    }),
  })

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`)
  }

  if (!data.result?.value) return null

  const accountData = data.result.value.data
  const buffer = base64ToBuffer(accountData)

  // Check discriminator (first 8 bytes) - Farm discriminator from IDL
  const FARM_DISCRIMINATOR = [0x55, 0x1e, 0x7b, 0x2d, 0x3c, 0x8a, 0x9f, 0x4e]
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== FARM_DISCRIMINATOR[i]) {
      throw new Error('Discriminator mismatch')
    }
  }

  // Decode the Farm account (after 8-byte discriminator)
  let offset = 8

  // name: string (length-prefixed)
  const nameLen = buffer.readUInt32LE(offset)
  offset += 4
  const name = buffer.slice(offset, offset + nameLen).toString('utf8')
  offset += nameLen

  // latE6: i32
  const latE6 = buffer.readInt32LE(offset)
  offset += 4

  // lngE6: i32
  const lngE6 = buffer.readInt32LE(offset)
  offset += 4

  // owner: Pubkey (32 bytes)
  const owner = new PublicKey(buffer.slice(offset, offset + 32)).toBase58()
  offset += 32

  // reportCount: u64
  const reportCount = Number(buffer.readBigUInt64LE(offset))
  offset += 8

  // verifiedReportCount: u64
  const verifiedReportCount = Number(buffer.readBigUInt64LE(offset))
  offset += 8

  // batchCount: u64
  const batchCount = Number(buffer.readBigUInt64LE(offset))
  offset += 8

  // policyCount: u64
  const policyCount = Number(buffer.readBigUInt64LE(offset))

  return {
    name,
    latE6,
    lngE6,
    owner,
    reportCount,
    verifiedReportCount,
    batchCount,
    policyCount,
  }
}
