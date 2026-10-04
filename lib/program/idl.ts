/**
 * lib/program/idl.ts — Accessors for the Anchor IDL copy in `lib/idl/`.
 *
 * The IDL is the single source of truth for everything the client needs:
 * instruction discriminators, account discriminators, argument types, account
 * metas (writable/signer/fixed addresses) and PDA seed metadata. Nothing in
 * this package hard-codes a discriminator or seed — it is all read from here,
 * so syncing the IDL (`npm run idl:sync`) after a program change updates the
 * whole client.
 *
 * The JSON import is cast once to a loose structural type: TypeScript's
 * inferred type for the literal is a union across entries (some have `pda`,
 * some have `address`, …) which would force narrowing everywhere.
 */

import rawIdl from '@/lib/idl/indorse_program.json'

/** Field/argument type in the IDL shorthand. */
export type IdlType =
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'i64'
  | 'bool'
  | 'string'
  | 'pubkey'
  | { array: [IdlType, number] }
  | { vec: IdlType }
  | { option: IdlType }
  | { defined: { name: string } }

export interface IdlField {
  name: string
  type: IdlType
}

/** Struct or unit-variant enum in the IDL `types` table. */
export type IdlTypeDef = { kind: 'struct'; fields: IdlField[] } | { kind: 'enum'; variants: { name: string }[] }

export interface IdlTypeEntry {
  name: string
  type: IdlTypeDef
}

/** Seed descriptor on a PDA account entry (`const` bytes, an account path…). */
export interface IdlSeed {
  kind: 'const' | 'account' | 'arg'
  value?: number[]
  path?: string
  account?: string
}

export interface IdlInstructionAccount {
  name: string
  writable?: boolean
  signer?: boolean
  /** Fixed address (e.g. the system program) — no caller input needed. */
  address?: string
  pda?: { seeds: IdlSeed[]; programId?: string }
}

export interface IdlInstruction {
  name: string
  discriminator: number[]
  accounts: IdlInstructionAccount[]
  args: IdlField[]
}

export interface IdlAccountEntry {
  name: string
  discriminator: number[]
}

export interface IndorseIdl {
  address: string
  instructions: IdlInstruction[]
  accounts: IdlAccountEntry[]
  types: IdlTypeEntry[]
}

export const IDL = rawIdl as unknown as IndorseIdl

/** Program address — kept in sync with `constants/app-config.ts` (guarded by tests). */
export const IDL_PROGRAM_ID = IDL.address

/** Look up an instruction definition or throw a helpful error. */
export function instructionDef(name: string): IdlInstruction {
  const ix = IDL.instructions.find((i) => i.name === name)
  if (!ix) throw new Error(`Unknown instruction "${name}" — is lib/idl/ stale? Run: npm run idl:sync`)
  return ix
}

/** Look up a top-level account definition (name + 8-byte discriminator). */
export function accountDef(name: string): IdlAccountEntry {
  const acc = IDL.accounts.find((a) => a.name === name)
  if (!acc) throw new Error(`Unknown account "${name}" — is lib/idl/ stale? Run: npm run idl:sync`)
  return acc
}

/** Look up a struct/enum type definition from the `types` table. */
export function typeDef(name: string): IdlTypeEntry {
  const t = IDL.types.find((entry) => entry.name === name)
  if (!t) throw new Error(`Unknown type "${name}" — is lib/idl/ stale? Run: npm run idl:sync`)
  return t
}

export function instructionDiscriminator(name: string): Uint8Array {
  return Uint8Array.from(instructionDef(name).discriminator)
}

export function accountDiscriminator(name: string): Uint8Array {
  return Uint8Array.from(accountDef(name).discriminator)
}

/* ── Name mapping ──────────────────────────────────────────────────────────── */

/** `lat_e6` → `latE6` (IDL snake_case → app camelCase). */
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** `latE6` → `lat_e6` (app camelCase → IDL snake_case). */
export function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

/** `Pending` → `pending` (enum variant → app enum value). */
export function variantToValue(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/** `pending` → `Pending` (app enum value → enum variant). */
export function valueToVariant(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
