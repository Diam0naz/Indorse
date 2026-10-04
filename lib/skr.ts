/**
 * lib/skr.ts — .skr domain resolution
 *
 * Reverse-resolves a Solana address to its first-sorting `.skr` AllDomains
 * (ANS) name.  Resolution always targets **mainnet**, regardless of the
 * cluster the rest of the app is configured against.
 *
 * The implementation is copied from the seeker-domains skill reference
 * (references/kit-resolver.md).  It uses only Kit codecs, @noble/hashes and
 * DataView — no Buffer, TextEncoder or Node built-ins — so it runs unchanged
 * under Hermes on device.
 *
 * Public surface:
 *   resolveSkrNames(rpc, address)   → string[] (sorted, empty when none)
 *   useSkrName(address?)            → string | null (TanStack Query, staleTime 1 h)
 *
 * Security note: a reverse-resolved name is the first-sorting name an address
 * _happens to hold_, and anyone can transfer a .skr name to any wallet without
 * the recipient's consent.  Display the name beside the truncated address, not
 * instead of it.
 */

import {
  address as toAddress,
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getUtf8Decoder,
  getUtf8Encoder,
  type Address,
  type Base58EncodedBytes,
  type createSolanaRpc as CreateSolanaRpcType,
} from '@solana/kit'
// Extensioned subpath: valid on @noble/hashes 1.x and 2.x.
import { sha256 } from '@noble/hashes/sha2.js'
import { useQuery } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────

type Rpc = ReturnType<typeof CreateSolanaRpcType>

// ── Constants ─────────────────────────────────────────────────────────────

const ANS_PROGRAM = toAddress('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK')
const TLD_HOUSE_PROGRAM = toAddress('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S')
const NAME_HOUSE_PROGRAM = toAddress('NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51')
const ROOT_ANS = toAddress('3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU')
const HASH_PREFIX = 'ALT Name Service'
const TLD = '.skr'

const HEADER_SIZE = 200
const OWNER_OFFSET = 40
const EXPIRES_AT_OFFSET = 104

// getMultipleAccounts takes at most 100 addresses per call.
const REVERSE_BATCH_SIZE = 100

// .skr lives on mainnet regardless of the cluster the rest of the app targets.
// The public endpoint is used intentionally here: EXPO_PUBLIC_* values are
// inlined at build time and visible to anyone who decompiles the APK, so a
// paid RPC key must never live in the client bundle.  Public-endpoint rate
// limits are acceptable for this prototype; use a server-side proxy once the
// key needs protecting.
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com'

const _rpc: Rpc = createSolanaRpc(MAINNET_RPC)

// ── Codec singletons ──────────────────────────────────────────────────────

const addressDecoder = getAddressDecoder()
const utf8Decoder = getUtf8Decoder()
const base64Encoder = getBase64Encoder()

const utf8 = (value: string) => new Uint8Array(getUtf8Encoder().encode(value))
const addressBytes = (value: Address) => new Uint8Array(getAddressEncoder().encode(value))
const ZERO_32 = new Uint8Array(32)

const hashName = (name: string) => sha256(utf8(HASH_PREFIX + name))

// ── PDA helpers ───────────────────────────────────────────────────────────

async function pda(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds })
  return derived
}

const deriveNameAccount = (name: string, parent?: Address) =>
  pda(ANS_PROGRAM, [hashName(name), ZERO_32, parent ? addressBytes(parent) : ZERO_32])

const deriveTldHouse = () => pda(TLD_HOUSE_PROGRAM, [utf8('tld_house'), utf8(TLD)])

const deriveReverseAccount = (nameAccount: Address, tldHouse: Address) =>
  pda(ANS_PROGRAM, [hashName(nameAccount), addressBytes(tldHouse), ZERO_32])

// ── Account fetch ─────────────────────────────────────────────────────────

async function fetchAccountData(rpc: Rpc, account: Address): Promise<Uint8Array | null> {
  const { value } = await rpc.getAccountInfo(account, { encoding: 'base64' }).send()
  return value ? new Uint8Array(base64Encoder.encode(value.data[0])) : null
}

// ── Core resolver ─────────────────────────────────────────────────────────

/**
 * Reverse lookup: returns every .skr name the address owns, sorted
 * lexicographically.  An empty array means "no names registered".
 * Rejects only when the RPC itself fails.
 */
export async function resolveSkrNames(rpc: Rpc, owner: Address): Promise<string[]> {
  const parent = await deriveNameAccount(TLD, ROOT_ANS)
  const tldHouse = await deriveTldHouse()

  const accounts = await rpc
    .getProgramAccounts(ANS_PROGRAM, {
      encoding: 'base64',
      // Only the expiry field — enough to drop expired names without pulling
      // 200-byte headers for every name the address holds.
      dataSlice: { offset: EXPIRES_AT_OFFSET, length: 8 },
      filters: [
        {
          memcmp: {
            offset: 8n,
            bytes: parent as string as Base58EncodedBytes,
            encoding: 'base58',
          },
        },
        {
          memcmp: {
            offset: BigInt(OWNER_OFFSET),
            bytes: owner as string as Base58EncodedBytes,
            encoding: 'base58',
          },
        },
      ],
    })
    .send()

  const now = Date.now()

  // Drop expired names.  expiresAt === 0 means non-expiring (Seeker-issued names).
  const live = accounts.filter(({ account }) => {
    const expiry = new Uint8Array(base64Encoder.encode(account.data[0]))
    if (expiry.length < 8) return false
    const expiresAt = Number(new DataView(expiry.buffer, expiry.byteOffset, 8).getBigUint64(0, true))
    return expiresAt === 0 || expiresAt * 1000 >= now
  })

  // Derive reverse-lookup accounts (PDA only — no network).
  const reverseAccounts = await Promise.all(live.map(({ pubkey }) => deriveReverseAccount(pubkey, tldHouse)))

  // Batch label reads — 100 per request, sequential, so an adversarially large
  // name-set does not fan out into an unbounded RPC burst.
  const names: string[] = []
  for (let i = 0; i < reverseAccounts.length; i += REVERSE_BATCH_SIZE) {
    const { value: batch } = await rpc
      .getMultipleAccounts(reverseAccounts.slice(i, i + REVERSE_BATCH_SIZE), {
        encoding: 'base64',
      })
      .send()

    for (const entry of batch) {
      if (!entry) continue
      const data = new Uint8Array(base64Encoder.encode(entry.data[0]))
      if (data.length <= HEADER_SIZE) continue
      const label = utf8Decoder.decode(data.subarray(HEADER_SIZE)).replace(/\0.*$/, '')
      if (label) names.push(`${label}${TLD}`)
    }
  }
  return names.sort()
}

/** Forward lookup: accepts "alice.skr" or "alice".  Returns null when unregistered. */
export async function resolveSkrDomain(rpc: Rpc, domain: string): Promise<Address | null> {
  const label = normalizeSkrName(domain)
  if (!label) return null

  const parent = await deriveNameAccount(TLD, ROOT_ANS)
  const nameAccount = await deriveNameAccount(label, parent)
  const data = await fetchAccountData(rpc, nameAccount)
  if (!data || data.length < HEADER_SIZE) return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const expiresAt = Number(view.getBigUint64(EXPIRES_AT_OFFSET, true))
  if (expiresAt !== 0 && expiresAt * 1000 < Date.now()) return null

  const owner = addressDecoder.decode(data.subarray(OWNER_OFFSET, OWNER_OFFSET + 32))

  const nftRecord = await deriveNftRecord(nameAccount, await deriveTldHouse())
  return owner === nftRecord ? resolveTokenizedOwner(rpc, nftRecord) : owner
}

async function deriveNftRecord(nameAccount: Address, tldHouse: Address): Promise<Address> {
  const nameHouse = await pda(NAME_HOUSE_PROGRAM, [utf8('name_house'), addressBytes(tldHouse)])
  return pda(NAME_HOUSE_PROGRAM, [utf8('nft_record'), addressBytes(nameHouse), addressBytes(nameAccount)])
}

async function resolveTokenizedOwner(rpc: Rpc, nftRecord: Address): Promise<Address | null> {
  const data = await fetchAccountData(rpc, nftRecord)
  if (!data || data[8] !== 1) return null // tag !== ActiveRecord
  const mint = addressDecoder.decode(data.subarray(74, 106))

  const { value: supply } = await rpc.getTokenSupply(mint).send()
  if (supply.decimals !== 0 || BigInt(supply.amount) !== 1n) return null

  const { value: largest } = await rpc.getTokenLargestAccounts(mint).send()
  if (!largest?.length) return null

  const { value: holder } = await rpc.getAccountInfo(largest[0].address, { encoding: 'jsonParsed' }).send()
  const parsed = holder?.data as { parsed?: { info?: { owner?: string } } } | undefined
  const ownerString = parsed?.parsed?.info?.owner
  return ownerString ? toAddress(ownerString) : null
}

/** Normalise user input to a bare label, or null if it cannot name a .skr domain. */
export function normalizeSkrName(input: string): string | null {
  const label = input
    .trim()
    .toLowerCase()
    .replace(/\.skr$/, '')
  return /^[a-z0-9-]{1,63}$/.test(label) ? label : null
}

// ── React hook ────────────────────────────────────────────────────────────

const SKR_STALE_TIME = 1_000 * 60 * 60 // 1 hour — names change rarely

/**
 * Resolves a wallet address to its first-sorting `.skr` name.
 *
 * Returns `null` while loading or when the address has no registered name.
 * The caller should fall back to `shortenAddress(address)` when the value is
 * null.
 *
 * Uses the module-level mainnet RPC client (public endpoint, no key required).
 */
export function useSkrName(address: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ['skr-name', address],
    enabled: !!address,
    staleTime: SKR_STALE_TIME,
    queryFn: async () => {
      const names = await resolveSkrNames(_rpc, toAddress(address!))
      // Already sorted by resolveSkrNames — [0] is stable.
      return names[0] ?? null
    },
  })
  return data ?? null
}
