import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair, PublicKey, type AccountInfo } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import {
  SGT_GROUP_MINT_ADDRESS,
  SGT_MINT_AUTHORITY,
  SGT_METADATA_ADDRESS,
  checkWalletForSGT,
  resetSgtCache,
  sgtEnabled,
  verifySgt,
  type SgtConnection,
} from '@/api/_lib/sgt'

// ── Fixtures ──────────────────────────────────────────────────────────
// Crafted Token-2022 mint account bytes, decoded by the REAL unpackers —
// these tests exercise production parsing, not a mock of it.

const WALLET = Keypair.generate().publicKey.toBase58()
const ACCOUNT_ADDRESS = Keypair.generate().publicKey // token-account pubkey (unused by the check)

const u16 = (n: number) => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: number) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
const key = (pk: string) => Buffer.from(new PublicKey(pk).toBuffer())
/** COption<Pubkey> — 4-byte tag + key (the classic mint fields use this). */
const optKey = (pk: string) => Buffer.concat([u32(1), key(pk)])
const noneKey = () => Buffer.alloc(36)

/**
 * Token-2022 extended mint: base mint (82) padded to ACCOUNT_SIZE (165),
 * an AccountType byte, then TLV extensions — MetadataPointer (18) as
 * OptionalNonZeroPubkey×2 and TokenGroupMember (23) as mint+group+u64.
 * Every SGT property can be forged independently to test the guards.
 */
function buildMintData({
  mintAuth = SGT_MINT_AUTHORITY,
  pointerAuth = SGT_MINT_AUTHORITY,
  pointerAddr = SGT_METADATA_ADDRESS,
  group = SGT_GROUP_MINT_ADDRESS,
  member = Keypair.generate().publicKey.toBase58(),
} = {}): Buffer {
  const base = Buffer.concat([optKey(mintAuth), u64(0), Buffer.from([0, 1]), noneKey()])
  const padding = Buffer.alloc(165 - 82)
  const accountType = Buffer.from([1]) // AccountType.Mint
  const pointer = Buffer.concat([key(pointerAuth), key(pointerAddr)])
  const memberTlv = Buffer.concat([key(member), key(group), u64(1)])
  return Buffer.concat([
    base,
    padding,
    accountType,
    u16(18),
    u16(pointer.length),
    pointer,
    u16(23),
    u16(memberTlv.length),
    memberTlv,
  ])
}

interface TokenAccountStub {
  mint: string
  amount: string
  state?: string
}

/** Duck-typed connection over fixtures. `mints` maps mint address → account data. */
function makeConnection(tokenAccounts: TokenAccountStub[], mints: Record<string, Buffer>) {
  const getParsedTokenAccountsByOwner = vi.fn(async () => ({
    context: { slot: 1 },
    value: tokenAccounts.map((stub) => ({
      pubkey: ACCOUNT_ADDRESS,
      account: {
        data: {
          program: 'spl-token-2022',
          parsed: {
            type: 'account',
            info: {
              mint: stub.mint,
              owner: WALLET,
              tokenAmount: {
                amount: stub.amount,
                decimals: 0,
                uiAmount: Number(stub.amount),
                uiAmountString: stub.amount,
              },
              ...(stub.state ? { state: stub.state } : {}),
            },
          },
          space: 165,
        },
        executable: false,
        lamports: 1_000_000,
        owner: TOKEN_2022_PROGRAM_ID,
        rentEpoch: 0,
      },
    })),
  }))
  const getMultipleAccountsInfo = vi.fn(async (keys: PublicKey[]) =>
    keys.map((k) => {
      const data = mints[k.toBase58()]
      if (!data) return null
      return {
        data,
        executable: false,
        lamports: 1_000_000,
        owner: TOKEN_2022_PROGRAM_ID,
        rentEpoch: 0,
      } satisfies AccountInfo<Buffer>
    }),
  )
  return { getParsedTokenAccountsByOwner, getMultipleAccountsInfo }
}

const asConnection = (stub: ReturnType<typeof makeConnection>) => stub as unknown as SgtConnection

afterEach(() => {
  resetSgtCache()
})

describe('checkWalletForSGT', () => {
  it('returns the mint address when the wallet holds a valid SGT', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1' }], { [mint]: buildMintData() })

    const result = await checkWalletForSGT(WALLET, asConnection(conn))

    expect(result).toEqual({ hasSGT: true, mintAddress: mint })
    expect(conn.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(1)
  })

  it('rejects a mint forged on any single SGT property — all four must match', async () => {
    const forged = [
      { mintAuth: Keypair.generate().publicKey.toBase58() }, // wrong mint authority
      { pointerAuth: Keypair.generate().publicKey.toBase58() }, // wrong metadata pointer authority
      { pointerAddr: Keypair.generate().publicKey.toBase58() }, // wrong metadata address
      { group: Keypair.generate().publicKey.toBase58() }, // wrong token group
    ]

    for (const mutation of forged) {
      const mint = Keypair.generate().publicKey.toBase58()
      const conn = makeConnection([{ mint, amount: '1' }], { [mint]: buildMintData(mutation) })

      const result = await checkWalletForSGT(WALLET, asConnection(conn))

      expect(result).toEqual({ hasSGT: false, mintAddress: null })
      expect(conn.getMultipleAccountsInfo).toHaveBeenCalled() // the mint WAS examined
    }
  })

  it('filters a zero-balance residue BEFORE the mint check — moving an SGT out ends the holding', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '0' }], { [mint]: buildMintData() }) // perfect SGT, empty wallet

    const result = await checkWalletForSGT(WALLET, asConnection(conn))

    expect(result).toEqual({ hasSGT: false, mintAddress: null })
    expect(conn.getMultipleAccountsInfo).not.toHaveBeenCalled() // never even examined
  })

  it('does not treat a frozen account as suspicious — balance is the discriminator', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1', state: 'frozen' }], { [mint]: buildMintData() })

    const result = await checkWalletForSGT(WALLET, asConnection(conn))

    expect(result).toEqual({ hasSGT: true, mintAddress: mint })
  })

  it('skips degenerate and unreadable entries without failing the whole check', async () => {
    const garbage = Keypair.generate().publicKey.toBase58()
    const good = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection(
      [
        { mint: '', amount: '1' }, // no mint string — dropped
        { mint: garbage, amount: '1' }, // not decodable as a mint
        { mint: good, amount: '1' }, // the real thing, later in the list
      ],
      { [garbage]: Buffer.alloc(200, 7), [good]: buildMintData() },
    )

    const result = await checkWalletForSGT(WALLET, asConnection(conn))

    expect(result).toEqual({ hasSGT: true, mintAddress: good })
  })

  it('treats a vanished account (null) as not-an-SGT', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1' }], {}) // account no longer exists

    const result = await checkWalletForSGT(WALLET, asConnection(conn))

    expect(result).toEqual({ hasSGT: false, mintAddress: null })
  })

  it('batches mint reads at 100 — providers reject larger requests', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection(
      Array.from({ length: 250 }, () => ({ mint, amount: '1' })),
      { [mint]: Buffer.alloc(200, 7) }, // never matches; the point is the batching
    )

    const result = await checkWalletForSGT(WALLET, asConnection(conn))

    expect(result.hasSGT).toBe(false)
    expect(conn.getMultipleAccountsInfo.mock.calls.map((call) => (call[0] as PublicKey[]).length)).toEqual([
      100, 100, 50,
    ])
  })

  it('throws when the token-account query fails — an outage is not a verdict', async () => {
    const conn = makeConnection([], {})
    conn.getParsedTokenAccountsByOwner.mockRejectedValueOnce(new Error('429 too many requests'))

    await expect(checkWalletForSGT(WALLET, asConnection(conn))).rejects.toThrow('429 too many requests')
  })

  it('throws when the mint batch read fails', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1' }], { [mint]: buildMintData() })
    conn.getMultipleAccountsInfo.mockRejectedValueOnce(new Error('rpc gone'))

    await expect(checkWalletForSGT(WALLET, asConnection(conn))).rejects.toThrow('rpc gone')
  })

  it('rejects a malformed wallet address outright', async () => {
    await expect(checkWalletForSGT('not-a-key')).rejects.toThrow()
  })
})

describe('verifySgt cache', () => {
  beforeEach(() => {
    resetSgtCache()
  })

  it('serves a repeated verdict from cache', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1' }], { [mint]: buildMintData() })

    const first = await verifySgt(WALLET, asConnection(conn))
    const second = await verifySgt(WALLET, asConnection(conn))

    expect(first).toEqual(second)
    expect(conn.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(1)
  })

  it('re-checks after resetSgtCache', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1' }], { [mint]: buildMintData() })

    await verifySgt(WALLET, asConnection(conn))
    resetSgtCache()
    await verifySgt(WALLET, asConnection(conn))

    expect(conn.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure — the next attempt hits the RPC again', async () => {
    const mint = Keypair.generate().publicKey.toBase58()
    const conn = makeConnection([{ mint, amount: '1' }], { [mint]: buildMintData() })
    conn.getParsedTokenAccountsByOwner.mockRejectedValueOnce(new Error('outage'))

    await expect(verifySgt(WALLET, asConnection(conn))).rejects.toThrow('outage')

    const recovered = await verifySgt(WALLET, asConnection(conn))
    expect(recovered).toEqual({ hasSGT: true, mintAddress: mint })
    expect(conn.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2)
  })
})

describe('sgtEnabled', () => {
  afterEach(() => {
    delete process.env.SGT_RPC_URL
  })

  it('is off until SGT_RPC_URL is configured', () => {
    delete process.env.SGT_RPC_URL
    expect(sgtEnabled()).toBe(false)

    process.env.SGT_RPC_URL = '   '
    expect(sgtEnabled()).toBe(false)

    process.env.SGT_RPC_URL = 'https://mainnet.example.invalid'
    expect(sgtEnabled()).toBe(true)
  })
})
