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

import { Connection, PublicKey } from '@solana/web3.js'
import { getMetadataPointerState, getTokenGroupMemberState, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token'

/** The authority both SGT signatures must name. */
export const SGT_MINT_AUTHORITY = 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4'
/** Metadata address and group mint are intentionally the same value. */
export const SGT_METADATA_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'
export const SGT_GROUP_MINT_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'

/** Public mainnet fallback for direct calls; the handlers stay env-gated. */
export const DEFAULT_SGT_RPC_URL = 'https://api.mainnet-beta.solana.com'

/** The check is on only when an endpoint was configured for it. */
export function sgtEnabled(): boolean {
  return !!process.env.SGT_RPC_URL?.trim()
}

export interface SgtResult {
  hasSGT: boolean
  /** The mint — the device identity anti-Sybil logic records. Null when absent. */
  mintAddress: string | null
}

/** The connection surface this module needs (web3.js `Connection` shape). */
export type SgtConnection = Pick<Connection, 'getParsedTokenAccountsByOwner' | 'getMultipleAccountsInfo'>

/** What a handler consumes — injectable so tests never touch mainnet. */
export type SgtChecker = (walletAddress: string) => Promise<SgtResult>

/** `getMultipleAccountsInfo` batches at 100 — most providers reject larger. */
const BATCH_SIZE = 100

/** Verdict cache — holdings change on the order of days, not minutes. */
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { value: SgtResult; expiresAt: number }>()

/** Test seam — drops cached verdicts between cases. */
export function resetSgtCache(): void {
  cache.clear()
}

/**
 * Batched mint examination: decode each candidate as a Token-2022 mint and
 * require all four SGT properties. Returns the MINT address (the device
 * identity), not a boolean — anti-Sybil needs to record which device.
 */
async function findSgtMint(connection: SgtConnection, mintPubkeys: PublicKey[]): Promise<string | null> {
  for (let i = 0; i < mintPubkeys.length; i += BATCH_SIZE) {
    const batch = mintPubkeys.slice(i, i + BATCH_SIZE)
    const infos = await connection.getMultipleAccountsInfo(batch)

    for (let j = 0; j < infos.length; j += 1) {
      const info = infos[j]
      if (!info) continue

      let mint
      try {
        mint = unpackMint(batch[j], info, TOKEN_2022_PROGRAM_ID)
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
 *
 * `connection` is injectable so tests exercise the real parsing against
 * fixtures instead of mainnet.
 */
export async function checkWalletForSGT(walletAddress: string, connection?: SgtConnection): Promise<SgtResult> {
  const conn = connection ?? new Connection(process.env.SGT_RPC_URL?.trim() || DEFAULT_SGT_RPC_URL, 'confirmed')

  const { value: tokenAccounts } = await conn.getParsedTokenAccountsByOwner(new PublicKey(walletAddress), {
    programId: TOKEN_2022_PROGRAM_ID,
  })

  // Balance filter first — a zero-balance residue is not a holding.
  const mintPubkeys = tokenAccounts
    .filter((entry) => entry.account.data.parsed?.info?.tokenAmount?.amount !== '0')
    .map((entry) => entry.account.data.parsed?.info?.mint)
    .filter((mint): mint is string => typeof mint === 'string' && mint.length > 0)
    .map((mint) => new PublicKey(mint))

  const mintAddress = await findSgtMint(conn, mintPubkeys)
  return { hasSGT: mintAddress !== null, mintAddress }
}

/**
 * The cached check the handlers call. Only successful verdicts enter the
 * cache — an outage propagates every time until the RPC recovers.
 * `connection` is the same test seam as `checkWalletForSGT`.
 */
export async function verifySgt(walletAddress: string, connection?: SgtConnection): Promise<SgtResult> {
  const now = Date.now()
  const hit = cache.get(walletAddress)
  if (hit && hit.expiresAt > now) return hit.value

  const value = await checkWalletForSGT(walletAddress, connection)
  cache.set(walletAddress, { value, expiresAt: now + CACHE_TTL_MS })
  return value
}
