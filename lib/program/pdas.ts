/**
 * lib/program/pdas.ts — Program-derived address helpers.
 *
 * Seeds mirror `programs/indorse_program/src/lib.rs` exactly:
 *
 *   farm               = ["farm", owner, u32(farm_index) LE]
 *   farm_counter       = ["farm_counter", owner]
 *   report             = ["report", farm, u32(report_count) LE]
 *   batch              = ["batch", farm, u32(batch_count) LE]
 *   escrow             = ["escrow", batch]
 *   escrow_vault       = ["escrow_vault", batch]
 *   policy             = ["policy", farm, u32(policy_count) LE]
 *   insurance_vault    = ["insurance_vault", farm, u32(policy_count) LE]
 *   weather oracle     = ["weather", farm, i64(season_start) LE]
 *   reward authority   = ["reward_authority"]
 *   config             = ["config"]
 *   treasury           = ["treasury"]
 *   verifier set       = ["verifier_set"]
 *   tally              = ["tally", report]
 *
 * The IDL carries the same seed metadata on each instruction's PDA account
 * entry; tests derive both ways and assert they agree, so drift between this
 * file and the program fails the suite rather than shipping.
 *
 * Derivation is pure CPU work (sha256 search loop), so results are memoized
 * per inputs — the same farm PDA is derived once per session.
 */

import { address, getBase58Encoder, getProgramDerivedAddress, type Address, type ReadonlyUint8Array } from '@solana/kit'
import { IDL_PROGRAM_ID } from './idl'

const base58Encoder = getBase58Encoder()
const programAddress = address(IDL_PROGRAM_ID)

const encoder = new TextEncoder()

/** u32 → 4 little-endian bytes (Anchor `to_le_bytes()`). */
function u32Seed(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

/** i64 → 8 little-endian bytes. */
function i64Seed(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true)
  return bytes
}

const cache = new Map<string, Promise<Address>>()

/** Derive a PDA under any program, memoized by program + seed serialization. */
function deriveFrom(programAddress: Address, seeds: ReadonlyUint8Array[]): Promise<Address> {
  const key = `${programAddress}|${seeds.map((s) => Array.from(s).join(',')).join('|')}`
  const hit = cache.get(key)
  if (hit) return hit
  const promise = getProgramDerivedAddress({ programAddress, seeds }).then(([pda]) => pda)
  cache.set(key, promise)
  return promise
}

/** Derive a PDA of the Indorse program from literal seeds, memoized. */
function derive(seeds: ReadonlyUint8Array[]): Promise<Address> {
  return deriveFrom(programAddress, seeds)
}

/** Forget every memoized derivation (tests). */
export function clearPdaCache(): void {
  cache.clear()
}

/**
 * `["farm", owner, u32(index) LE]` — the owner's `index`-th farm.
 *
 * The third seed makes a wallet's farms a roster: index 0, 1, 2 … each on
 * its own PDA, allocated by `farmCounterPda(owner).count` on chain.
 */
export function farmPda(owner: string, index: number): Promise<Address> {
  return derive([encoder.encode('farm'), base58Encoder.encode(owner), u32Seed(index)])
}

/** `["farm_counter", owner]` — the owner's farm allocator (next index = count). */
export function farmCounterPda(owner: string): Promise<Address> {
  return derive([encoder.encode('farm_counter'), base58Encoder.encode(owner)])
}

/** `["report", farm, u32(reportCount) LE]` */
export function reportPda(farm: string, reportCount: number): Promise<Address> {
  return derive([encoder.encode('report'), base58Encoder.encode(farm), u32Seed(reportCount)])
}

/** `["batch", farm, u32(batchCount) LE]` */
export function batchPda(farm: string, batchCount: number): Promise<Address> {
  return derive([encoder.encode('batch'), base58Encoder.encode(farm), u32Seed(batchCount)])
}

/** `["escrow", batch]` */
export function escrowPda(batch: string): Promise<Address> {
  return derive([encoder.encode('escrow'), base58Encoder.encode(batch)])
}

/** `["escrow_vault", batch]` — token account holding escrowed USDC. */
export function escrowVaultPda(batch: string): Promise<Address> {
  return derive([encoder.encode('escrow_vault'), base58Encoder.encode(batch)])
}

/** `["policy", farm, u32(policyCount) LE]` */
export function policyPda(farm: string, policyCount: number): Promise<Address> {
  return derive([encoder.encode('policy'), base58Encoder.encode(farm), u32Seed(policyCount)])
}

/** `["insurance_vault", farm, u32(policyCount) LE]` — pooled coverage vault. */
export function insuranceVaultPda(farm: string, policyCount: number): Promise<Address> {
  return derive([encoder.encode('insurance_vault'), base58Encoder.encode(farm), u32Seed(policyCount)])
}

/** `["weather", farm, i64(seasonStart) LE]` — season reading tally; its frozen median settles policies. */
export function weatherOraclePda(farm: string, seasonStart: number): Promise<Address> {
  return derive([encoder.encode('weather'), base58Encoder.encode(farm), i64Seed(seasonStart)])
}

/** `["reward_authority"]` — admin-held reward pool authority. */
export function rewardAuthorityPda(): Promise<Address> {
  return derive([encoder.encode('reward_authority')])
}

/** `["config"]` — the program's authority roles (admin/verifier/oracle). */
export function configPda(): Promise<Address> {
  return derive([encoder.encode('config')])
}

/** `["treasury"]` — program custody; its USDC ATA receives swept refunds. */
export function treasuryPda(): Promise<Address> {
  return derive([encoder.encode('treasury')])
}

/** `["verifier_set"]` — Phase 1 K-of-N quorum: k, bond price, members. */
export function verifierSetPda(): Promise<Address> {
  return derive([encoder.encode('verifier_set')])
}

/** `["oracle_set"]` — Phase 2 reader seats: odd quorum k, members, no bonds. */
export function oracleSetPda(): Promise<Address> {
  return derive([encoder.encode('oracle_set')])
}

/** `["tally", report]` — Phase 1 per-report vote record. */
export function tallyPda(report: string): Promise<Address> {
  return derive([encoder.encode('tally'), base58Encoder.encode(report)])
}

/* ── SPL token accounts ────────────────────────────────────────────────────── */

const TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/**
 * The associated token account (ATA) holding `owner`'s `mint` balance.
 *
 * Seeds mirror the Associated Token Account program:
 * `[owner, token_program, mint]` — client-side derivation, no RPC. A wallet
 * which has never held `mint` has no account here yet, so every flow that
 * debits it (create_policy's premium, create_escrow's funding) prepends
 * `buildCreateAtaInstruction` — idempotent, one extra instruction in the same
 * transaction. A balance still has to cover the transfer; the chain rejects
 * it otherwise, and that error surfaces in the UI.
 */
export function ataPda(owner: string, mint: string): Promise<Address> {
  return deriveFrom(ASSOCIATED_TOKEN_PROGRAM_ID, [
    base58Encoder.encode(owner),
    base58Encoder.encode(TOKEN_PROGRAM_ID),
    base58Encoder.encode(mint),
  ])
}
