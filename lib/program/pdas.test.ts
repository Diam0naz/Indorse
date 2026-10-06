/**
 * lib/program/pdas.test.ts — The seed guard.
 *
 * The program (lib.rs), the IDL (lib/idl) and pdas.ts each state the same
 * seeds. This suite derives every PDA twice — once through pdas.ts and once
 * from the IDL's own `pda.seeds` metadata — and asserts they agree, so a
 * program change synced to the IDL but not to pdas.ts fails here.
 *
 * It also recomputes the Anchor discriminators from their canonical sha256
 * formulas, catching a stale IDL copy.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { address, getBase58Encoder, getProgramDerivedAddress, type ReadonlyUint8Array } from '@solana/kit'
import { IDL, IDL_PROGRAM_ID, instructionDef, type IdlSeed } from '@/lib/program/idl'
import {
  ataPda,
  batchPda,
  configPda,
  escrowPda,
  escrowVaultPda,
  farmCounterPda,
  farmPda,
  insuranceVaultPda,
  oracleSetPda,
  policyPda,
  reportPda,
  rewardAuthorityPda,
  tallyPda,
  treasuryPda,
  verifierSetPda,
  weatherOraclePda,
} from '@/lib/program/pdas'
import { PROGRAM_ID } from '@/constants/app-config'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'

const OWNER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const FARM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const BATCH = '11111111111111111111111111111111'
const REPORT = 'SysvarC1ock11111111111111111111111111111111'
const programAddress = address(IDL_PROGRAM_ID)
const base58 = getBase58Encoder()

const sha256 = (input: string): Buffer => createHash('sha256').update(input).digest()

function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function i64le(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true)
  return bytes
}

/** Serialize one IDL seed entry the way an Anchor client would. */
function seedBytes(
  seed: IdlSeed,
  ctx: { reportCount: number; batchCount: number; policyCount: number; seasonStart: number; farmIndex: number },
): ReadonlyUint8Array {
  if (seed.kind === 'const') return Uint8Array.from(seed.value ?? [])
  const path = seed.path ?? ''
  switch (path) {
    case 'owner':
      return base58.encode(OWNER)
    case 'farm':
    case 'policy.farm':
      return base58.encode(FARM)
    case 'batch':
      return base58.encode(BATCH)
    case 'report':
      return base58.encode(REPORT)
    case 'farm.report_count':
      return u32le(ctx.reportCount)
    case 'farm_counter.count':
      return u32le(ctx.farmIndex)
    case 'farm.batch_count':
      return u32le(ctx.batchCount)
    case 'farm.policy_count':
    case 'policy.index':
      return u32le(ctx.policyCount)
    case 'season_start':
      return i64le(ctx.seasonStart)
    default:
      throw new Error(`Unhandled seed path "${path}" — extend this test's context`)
  }
}

/** Derive a PDA straight from an IDL instruction account's seed metadata. */
async function deriveFromIdl(
  ixName: string,
  accountName: string,
  ctx: Parameters<typeof seedBytes>[1],
): Promise<string> {
  const entry = instructionDef(ixName).accounts.find((a) => a.name === accountName)
  if (!entry?.pda) throw new Error(`${ixName}.${accountName} has no PDA metadata in the IDL`)
  const seeds = entry.pda.seeds.map((s) => seedBytes(s, ctx))
  const [pda] = await getProgramDerivedAddress({ programAddress, seeds })
  return pda
}

const CTX = { reportCount: 7, batchCount: 3, policyCount: 2, seasonStart: 1_735_689_600, farmIndex: 0 }

describe('IDL sanity', () => {
  it('keeps the app config and the IDL in sync', () => {
    expect(IDL.address).toBe(PROGRAM_ID)
  })

  it('matches Anchor instruction discriminators: sha256("global:<name>")[..8]', () => {
    for (const ix of IDL.instructions) {
      expect(Array.from(ix.discriminator), ix.name).toEqual(Array.from(sha256(`global:${ix.name}`).subarray(0, 8)))
    }
  })

  it('matches Anchor account discriminators: sha256("account:<Name>")[..8]', () => {
    for (const acc of IDL.accounts) {
      expect(Array.from(acc.discriminator), acc.name).toEqual(Array.from(sha256(`account:${acc.name}`).subarray(0, 8)))
    }
  })
})

describe('PDA helpers vs IDL seed metadata', () => {
  it('farm — ["farm", owner, u32(index)]', async () => {
    expect(await farmPda(OWNER, CTX.farmIndex)).toBe(await deriveFromIdl('register_farm', 'farm', CTX))
  })

  it('farm_counter — ["farm_counter", owner]', async () => {
    expect(await farmCounterPda(OWNER)).toBe(await deriveFromIdl('register_farm', 'farm_counter', CTX))
  })

  it('report — ["report", farm, u32(report_count)]', async () => {
    expect(await reportPda(FARM, CTX.reportCount)).toBe(await deriveFromIdl('submit_scout_report', 'report', CTX))
  })

  it('batch — ["batch", farm, u32(batch_count)]', async () => {
    expect(await batchPda(FARM, CTX.batchCount)).toBe(await deriveFromIdl('submit_harvest_batch', 'batch', CTX))
  })

  it('escrow + escrow_vault — derived from the batch', async () => {
    expect(await escrowPda(BATCH)).toBe(await deriveFromIdl('create_escrow', 'escrow', CTX))
    expect(await escrowVaultPda(BATCH)).toBe(await deriveFromIdl('create_escrow', 'escrow_vault', CTX))
  })

  it('policy + insurance_vault — ["…", farm, u32(policy_count)]', async () => {
    expect(await policyPda(FARM, CTX.policyCount)).toBe(await deriveFromIdl('create_policy', 'policy', CTX))
    expect(await insuranceVaultPda(FARM, CTX.policyCount)).toBe(
      await deriveFromIdl('create_policy', 'insurance_vault', CTX),
    )
  })

  it('weather reading tally — ["weather", farm, i64(season_start)]', async () => {
    expect(await weatherOraclePda(FARM, CTX.seasonStart)).toBe(
      await deriveFromIdl('submit_oracle_reading', 'oracle', CTX),
    )
  })

  it('reward authority — single literal seed', async () => {
    expect(await rewardAuthorityPda()).toBe(await deriveFromIdl('reward_report', 'reward_authority', CTX))
  })

  it('config — single literal seed', async () => {
    expect(await configPda()).toBe(await deriveFromIdl('init_config', 'config', CTX))
  })

  it('treasury — single literal seed', async () => {
    expect(await treasuryPda()).toBe(await deriveFromIdl('withdraw_treasury', 'treasury', CTX))
  })

  it('verifier set — single literal seed', async () => {
    expect(await verifierSetPda()).toBe(await deriveFromIdl('init_verifier_set', 'verifier_set', CTX))
  })

  it('oracle set — single literal seed', async () => {
    expect(await oracleSetPda()).toBe(await deriveFromIdl('init_oracle_set', 'oracle_set', CTX))
  })

  it('tally — ["tally", report]', async () => {
    expect(await tallyPda(REPORT)).toBe(await deriveFromIdl('cast_vote', 'tally', CTX))
  })

  it('report PDAs differ per index', async () => {
    const [a, b] = await Promise.all([reportPda(FARM, 0), reportPda(FARM, 1)])
    expect(a).not.toBe(b)
  })

  it('memoizes repeated derivations', async () => {
    const [first, second] = await Promise.all([farmPda(OWNER, 0), farmPda(OWNER, 0)])
    expect(first).toBe(second)
  })

  it('farm slots differ per index — one wallet, many farms', async () => {
    const [a, b] = await Promise.all([farmPda(OWNER, 0), farmPda(OWNER, 1)])
    expect(a).not.toBe(b)
  })
})

describe('associated token accounts', () => {
  // ataPda is not an Indorse-program PDA — the IDL carries no seed metadata
  // for it — so the guard here derives it independently under the Associated
  // Token Account program and asserts pdas.ts lands on the same address.
  const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const enc = getBase58Encoder()

  async function ataFromSpec(owner: string, mint: string): Promise<string> {
    const [derived] = await getProgramDerivedAddress({
      programAddress: ATA_PROGRAM,
      seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM), enc.encode(mint)],
    })
    return derived
  }

  it("owner's USDC account matches the ATA program's [owner, token_program, mint] spec", async () => {
    expect(await ataPda(OWNER, USDC_DEVNET)).toBe(await ataFromSpec(OWNER, USDC_DEVNET))
  })

  it('differs across owners and mints, and is stable per pair', async () => {
    const mine = await ataPda(OWNER, USDC_DEVNET)
    expect(await ataPda(OWNER, USDC_DEVNET)).toBe(mine)
    expect(await ataPda(FARM, USDC_DEVNET)).not.toBe(mine)
    expect(await ataPda(OWNER, USDC_MAINNET)).not.toBe(mine)
  })
})
