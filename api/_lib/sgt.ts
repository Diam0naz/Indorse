/**
 * api/_lib/sgt.ts — server-side Seeker Genesis Token check (shared module)
 *
 * The SGT is a Token-2022 NFT minted once per Seeker device: holding one is
 * evidence of owning a Seeker. Two handlers consume this module, and both
 * must decide server-side — a client-decided `hasSGT` boolean is worth
 * nothing, since a patched app can claim anything:
 *
 *   - `/api/siws/verify` — entitlement alongside the dev allowlist (the
 *     allowlist stays the development/demo path; a deny there falls
 *     through to this real gate)
 *   - `/api/funds-tier`  — the tier3 $500 ceiling's `seeker` claim, which
 *     was client-asserted until now
 *
 * Rules below are security-relevant, not style (from the verification
 * skill):
 *
 *   - ALL FOUR mint properties must match — mint authority, metadata
 *     pointer authority, metadata pointer address, token group member
 *     group. Checking fewer is a bypass: each one alone can be forged by
 *     an unrelated token.
 *   - Token-2022 accounts with `amount === 0` are filtered BEFORE the mint
 *     is examined. Transferring an SGT out leaves the source ATA open
 *     forever at zero balance, and the mint check never looks at balance —
 *     unfiltered, every wallet that EVER held an SGT verifies permanently.
 *   - Frozen is NOT suspicious: Solana Mobile holds the freeze authority
 *     and re-freezes legitimate ATAs on arrival. Balance is the
 *     discriminator; freeze state is not.
 *   - An RPC failure throws. Swallowing it into `{hasSGT:false}` would
 *     turn an outage into "you do not own a Seeker" — a silent false
 *     negative. The handlers answer 503 instead.
 *
 * SGTs exist only on mainnet — there is no devnet equivalent. Setting
 * `SGT_RPC_URL` (server-side only, never `EXPO_PUBLIC_*`) enables the
 * check; unset, both handlers keep their legacy behaviour, so development
 * and tests never silently depend on mainnet. Verdicts are cached briefly
 * per address (holdings change on the order of days; the cache is what
 * keeps a public RPC viable) — failures are never cached.
 */

// Use plain HTTP RPC + @solana/spl-token only (no @solana/web3.js to avoid rpc-websockets ESM issue)
// We need a minimal PublicKey implementation for base58 encoding/decoding

const BS58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function decodeBase58(str: string): Uint8Array {
  let num = BigInt(0)
  for (const char of str) {
    const idx = BS58_ALPHABET.indexOf(char)
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`)
    num = num * 58n + BigInt(idx)
  }
  const bytes = []
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn))
    num >>= 8n
  }
  // Handle leading zeros (base58 '1' = zero byte)
  let leadingZeros = 0
  for (const char of str) {
    if (char === '1') leadingZeros++
    else break
  }
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes])
}

function encodeBase58(bytes: Uint8Array): string {
  let leadingZeros = 0
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++
    else break
  }
  let num = BigInt(0)
  for (const byte of bytes) {
    num = (num << 8n) + BigInt(byte)
  }
  let str = ''
  while (num > 0n) {
    const rem = Number(num % 58n)
    str = BS58_ALPHABET[rem] + str
    num /= 58n
  }
  return '1'.repeat(leadingZeros) + str
}

/** Minimal PublicKey implementation for @solana/spl-token compatibility */
export class PublicKey {
  readonly _bn: Uint8Array

  constructor(value: string | Uint8Array) {
    if (typeof value === 'string') {
      this._bn = decodeBase58(value)
    } else {
      this._bn = value
    }
    if (this._bn.length !== 32) {
      throw new Error(`PublicKey must be 32 bytes, got ${this._bn.length}`)
    }
  }

  toBase58(): string {
    return encodeBase58(this._bn)
  }

  toBuffer(): Buffer {
    return Buffer.from(this._bn)
  }

  // Compatibility methods for @solana/spl-token
  equals(other: PublicKey): boolean {
    return this._bn.every((byte, i) => byte === other._bn[i])
  }
  toJSON(): string {
    return this.toBase58()
  }
  toBytes(): Uint8Array {
    return this._bn
  }
  get [Symbol.toStringTag](): string {
    return 'PublicKey'
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  encode(): any {
    return this._bn
  }
}

/** The authority both SGT signatures must name. */
export const SGT_MINT_AUTHORITY = 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4'
/** Metadata address and group mint are intentionally the same value. */
export const SGT_METADATA_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'
export const SGT_GROUP_MINT_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'

/** Public mainnet fallback for direct calls; the handlers stay env-gated. */
export const DEFAULT_SGT_RPC_URL = 'https://api.mainnet-beta.solana.com'

/** Token-2022 program ID */
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

/** The check is on only when an endpoint was configured for it. */
export function sgtEnabled(): boolean {
  return !!process.env.SGT_RPC_URL?.trim()
}

export interface SgtResult {
  hasSGT: boolean
  /** The mint — the device identity anti-Sybil logic records. Null when absent. */
  mintAddress: string | null
}

/** What a handler consumes — injectable so tests never touch mainnet. */
export type SgtChecker = (walletAddress: string) => Promise<SgtResult>

/** Verdict cache — holdings change on the order of days, not minutes. */
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { value: SgtResult; expiresAt: number }>()

/** Test seam — drops cached verdicts between cases. */
export function resetSgtCache(): void {
  cache.clear()
}

/** JSON-RPC request helper */
async function rpcRequest<T>(method: string, params: unknown[], rpcUrl: string): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`)
  }
  const data = await response.json()
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message} (code ${data.error.code})`)
  }
  return data.result
}

/** Get parsed token accounts by owner using plain HTTP RPC */
async function getParsedTokenAccountsByOwner(
  walletAddress: string,
  rpcUrl: string,
): Promise<Array<{ mint: string; amount: string }>> {
  const result = await rpcRequest<any>(
    'getTokenAccountsByOwner',
    [
      walletAddress,
      { programId: TOKEN_2022_PROGRAM_ID.toBase58() },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ],
    rpcUrl,
  )

  return result.value
    .filter((entry: any) => entry.account.data.parsed?.info?.tokenAmount?.amount !== '0')
    .map((entry: any) => ({
      mint: entry.account.data.parsed.info.mint,
      amount: entry.account.data.parsed.info.tokenAmount.amount,
    }))
}

/** Get multiple account info using plain HTTP RPC */
async function getMultipleAccountsInfo(
  mintPubkeys: string[],
  rpcUrl: string,
): Promise<Array<{ data: string; executable: boolean; lamports: number; owner: string; rentEpoch: number } | null>> {
  const result = await rpcRequest<any>(
    'getMultipleAccounts',
    [mintPubkeys, { encoding: 'base64', commitment: 'confirmed' }],
    rpcUrl,
  )

  return result.value
}

/** Batched mint examination: decode each candidate as a Token-2022 mint and require all four SGT properties */
async function findSgtMint(mintPubkeys: string[], rpcUrl: string): Promise<string | null> {
  // Import @solana/spl-token dynamically to avoid ESM issues
  const splToken = await import('@solana/spl-token')
  const { unpackMint, getMetadataPointerState, getTokenGroupMemberState } = splToken

  const BATCH_SIZE = 100
  for (let i = 0; i < mintPubkeys.length; i += BATCH_SIZE) {
    const batch = mintPubkeys.slice(i, i + BATCH_SIZE)
    const infos = await getMultipleAccountsInfo(batch, rpcUrl)

    for (let j = 0; j < infos.length; j += 1) {
      const info = infos[j]
      if (!info) continue

      let mint
      try {
        // Convert base64 to Uint8Array
        const buffer = Buffer.from(info.data[0], 'base64')
        mint = unpackMint(
          new PublicKey(batch[j]),
          { data: buffer, owner: TOKEN_2022_PROGRAM_ID } as any,
          TOKEN_2022_PROGRAM_ID as any,
        )
      } catch {
        continue // Unreadable or not a Token-2022 mint — not an SGT.
      }

      const metadataPointer = getMetadataPointerState(mint)
      const groupMember = getTokenGroupMemberState(mint)

      const ok =
        mint.mintAuthority?.toBase58() === SGT_MINT_AUTHORITY &&
        metadataPointer?.authority?.toBase58() === SGT_MINT_AUTHORITY &&
        metadataPointer?.metadataAddress?.toBase58() === SGT_METADATA_ADDRESS &&
        groupMember?.group?.toBase58() === SGT_GROUP_MINT_ADDRESS

      if (ok) return mint.address.toBase58()
    }
  }
  return null
}

/**
 * Does this wallet CURRENTLY hold an SGT? Throws on RPC failure (the
 * caller distinguishes outage from absence — see the module header).
 */
export async function checkWalletForSGT(walletAddress: string, rpcUrl?: string): Promise<SgtResult> {
  const url = rpcUrl?.trim() || process.env.SGT_RPC_URL?.trim() || DEFAULT_SGT_RPC_URL

  const tokenAccounts = await getParsedTokenAccountsByOwner(walletAddress, url)

  const mintPubkeys = tokenAccounts
    .map((entry) => entry.mint)
    .filter((mint): mint is string => typeof mint === 'string' && mint.length > 0)

  const mintAddress = await findSgtMint(mintPubkeys, url)
  return { hasSGT: mintAddress !== null, mintAddress }
}

/**
 * The cached check the handlers call. Only successful verdicts enter the
 * cache — an outage propagates every time until the RPC recovers.
 */
export async function verifySgt(walletAddress: string, rpcUrl?: string): Promise<SgtResult> {
  const now = Date.now()
  const hit = cache.get(walletAddress)
  if (hit && hit.expiresAt > now) return hit.value

  const value = await checkWalletForSGT(walletAddress, rpcUrl)
  cache.set(walletAddress, { value, expiresAt: now + CACHE_TTL_MS })
  return value
}
