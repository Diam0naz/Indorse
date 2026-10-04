/**
 * lib/program/sas.ts — Solana Attestation Service client, without the SDK.
 *
 * The official `@solana/attestation` client targets `@solana/kit` v8 and is not
 * published, so this module reimplements the two instructions this app needs —
 * `CreateCredential` and `CreateSchema` (plus `CreateAttestation`) — straight
 * from the program's committed Codama IDL. It is a *deliberately small* slice:
 * nine instructions exist on chain, and only these three are reproduced here.
 *
 * PROGRAM SHAPE (differs from the Indorse program in two ways that bite):
 *   - Discriminators are ONE byte (the instruction name's numeric slot), not
 *     Anchor's eight-byte `sha256("global:name")`. `createCredential` = 0,
 *     `createSchema` = 1, `createAttestation` = 6.
 *   - State accounts (credential/schema/attestation) carry no discriminator at
 *     all — the account data is the struct fields directly.
 *
 * PDAs (seeds from the IDL's `pdas` node):
 *   credential  = ["credential", authority, name]
 *   schema      = ["schema", credential, name, u8(version)]
 *   attestation = ["attestation", credential, schema, nonce]
 *
 * A schema's `layout` is positional: one numeric type code per field, with
 * `fieldNames` naming them in the same order. The email schema this app issues
 * is `[string, i64, string]` = `["emailHash", "verifiedAt", "method"]`.
 */

import {
  AccountRole,
  address,
  getBase58Encoder,
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
} from '@solana/kit'

/** The SAS program, identical on mainnet and devnet. */
export const SAS_PROGRAM_ID = '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG'

/** The system program — a fixed account in every SAS create instruction. */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'

const SAS_PROGRAM = address(SAS_PROGRAM_ID)
const encoder = new TextEncoder()
const base58Encoder = getBase58Encoder()

/** Instruction discriminators — the one-byte slot each handler routes on. */
export const SAS_INSTRUCTION = {
  createCredential: 0,
  createSchema: 1,
  changeSchemaStatus: 2,
  changeAuthorizedSigners: 3,
  changeSchemaDescription: 4,
  changeSchemaVersion: 5,
  createAttestation: 6,
  closeAttestation: 7,
  tokenizeSchema: 9,
  createTokenizedAttestation: 10,
  closeTokenizedAttestation: 11,
} as const

/**
 * Schema type codes, exactly as documented by SAS. A layout is an array of
 * these; `fieldNames` names each position.
 */
export const SAS_SCHEMA_TYPE = {
  u8: 0,
  u16: 1,
  u32: 2,
  u64: 3,
  u128: 4,
  i8: 5,
  i16: 6,
  i32: 7,
  i64: 8,
  i128: 9,
  bool: 10,
  char: 11,
  string: 12,
  vecU8: 13,
  vecU16: 14,
  vecU32: 15,
  vecU64: 16,
  vecU128: 17,
  vecI8: 18,
  vecI16: 19,
  vecI32: 20,
  vecI64: 21,
  vecI128: 22,
  vecBool: 23,
  vecChar: 24,
  vecString: 25,
} as const

export type SasSchemaTypeName = keyof typeof SAS_SCHEMA_TYPE

/* ── The Indorse email schema ─────────────────────────────────────────────── */

/** Credential name — the issuer's stable identity under which schemas live. */
export const INDORSE_CREDENTIAL_NAME = 'indorse'

/** Schema naming the three fields of an "email verified" attestation. */
export const INDORSE_EMAIL_SCHEMA = {
  name: 'indorse.email',
  description: 'Indorse: proves a wallet controls an email address (address hashed).',
  layout: [SAS_SCHEMA_TYPE.string, SAS_SCHEMA_TYPE.i64, SAS_SCHEMA_TYPE.string] as number[],
  fieldNames: ['emailHash', 'verifiedAt', 'method'] as string[],
  version: 1,
} as const

/* ── PDA finders ───────────────────────────────────────────────────────────── */

/** `["credential", authority, name]` — the issuer's credential account. */
export async function credentialPda(authority: string, name: string): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SAS_PROGRAM,
    seeds: [encoder.encode('credential'), base58Encoder.encode(authority), encoder.encode(name)],
  })
  return pda
}

/** `["schema", credential, name, u8(version)]` — a schema under a credential. */
export async function schemaPda(credential: string, name: string, version = 1): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SAS_PROGRAM,
    seeds: [
      encoder.encode('schema'),
      base58Encoder.encode(credential),
      encoder.encode(name),
      Uint8Array.of(version & 0xff),
    ],
  })
  return pda
}

/** `["attestation", credential, schema, nonce]` — one issued attestation. */
export async function attestationPda(credential: string, schema: string, nonce: string): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SAS_PROGRAM,
    seeds: [
      encoder.encode('attestation'),
      base58Encoder.encode(credential),
      base58Encoder.encode(schema),
      base58Encoder.encode(nonce),
    ],
  })
  return pda
}

/* ── Borsh-ish writer ──────────────────────────────────────────────────────── */

class Writer {
  private buf = new Uint8Array(256)
  private view = new DataView(this.buf.buffer)
  private len = 0

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
    this.view = new DataView(next.buffer)
  }

  u8(value: number): this {
    this.ensure(1)
    this.view.setUint8(this.len, value & 0xff)
    this.len += 1
    return this
  }

  u32(value: number): this {
    this.ensure(4)
    this.view.setUint32(this.len, value, true)
    this.len += 4
    return this
  }

  i64(value: bigint): this {
    this.ensure(8)
    this.view.setBigInt64(this.len, value, true)
    this.len += 8
    return this
  }

  u64(value: bigint): this {
    this.ensure(8)
    this.view.setBigUint64(this.len, value, true)
    this.len += 8
    return this
  }

  raw(bytes: ReadonlyUint8Array): this {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.len)
    this.len += bytes.length
    return this
  }

  /** u32 little-endian length followed by the UTF-8 bytes. */
  string(value: string): this {
    const bytes = encoder.encode(value)
    this.u32(bytes.length).raw(bytes)
    return this
  }

  /** u32 little-endian length followed by raw bytes (SAS `bytes` fields). */
  bytes(value: ReadonlyUint8Array): this {
    this.u32(value.length).raw(value)
    return this
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    return BigInt(value)
  }
  throw new Error(`Expected an integer for "${field}", got ${typeof value}`)
}

/**
 * Serialize one schema field. Supports the primitive types this app's schemas
 * use — enough to encode `[string, i64, string]` and friends without porting
 * the whole type table.
 */
function writeField(w: Writer, code: number, value: unknown, field: string): void {
  switch (code) {
    case SAS_SCHEMA_TYPE.u8:
      return w.u8(Number(value))
    case SAS_SCHEMA_TYPE.i64:
      return w.i64(asBigInt(value, field))
    case SAS_SCHEMA_TYPE.u64:
      return w.u64(asBigInt(value, field))
    case SAS_SCHEMA_TYPE.bool:
      return w.u8(value ? 1 : 0)
    case SAS_SCHEMA_TYPE.string:
      return w.string(String(value))
    case SAS_SCHEMA_TYPE.vecU8: {
      const bytes = Uint8Array.from((value as ArrayLike<number>) ?? [])
      w.u32(bytes.length).raw(bytes)
      return
    }
    case SAS_SCHEMA_TYPE.vecString: {
      const items = (value as unknown[]) ?? []
      w.u32(items.length)
      for (const item of items) w.string(String(item))
      return
    }
    default:
      throw new Error(`Unsupported SAS schema type code ${code} for "${field}"`)
  }
}

/**
 * Encode attestation data to match a schema layout — positional, in the same
 * order as `fieldNames`. This is what goes into `CreateAttestation.data`.
 */
export function serializeAttestationData(layout: readonly number[], values: readonly unknown[]): Uint8Array {
  if (layout.length !== values.length) {
    throw new Error(`Layout has ${layout.length} fields but ${values.length} values were given`)
  }
  const w = new Writer()
  layout.forEach((code, i) => writeField(w, code, values[i], `field[${i}]`))
  return w.toBytes()
}

/* ── Instruction builders ──────────────────────────────────────────────────── */

function meta(pubkey: string, role: AccountRole): AccountMeta {
  return { address: address(pubkey), role }
}

/**
 * `CreateCredential` — register the issuer and its authorized signer set.
 * The credential and the authority are both required; signers may include the
 * authority and any addresses allowed to write attestations.
 */
export async function createCredentialInstruction(input: {
  payer: string
  authority: string
  name: string
  signers: string[]
}): Promise<Instruction> {
  const credential = await credentialPda(input.authority, input.name)
  const w = new Writer()
  w.u8(SAS_INSTRUCTION.createCredential).string(input.name)
  w.u32(input.signers.length)
  for (const signer of input.signers) w.raw(base58Encoder.encode(signer))

  return {
    programAddress: SAS_PROGRAM,
    accounts: [
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      meta(credential, AccountRole.WRITABLE),
      meta(input.authority, AccountRole.READONLY_SIGNER),
      meta(SYSTEM_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: w.toBytes(),
  }
}

/** `CreateSchema` — publish a field layout under a credential. */
export async function createSchemaInstruction(input: {
  payer: string
  authority: string
  credential: string
  name: string
  description: string
  layout: readonly number[]
  fieldNames: readonly string[]
  version?: number
}): Promise<Instruction> {
  if (input.layout.length !== input.fieldNames.length) {
    throw new Error(`Schema "${input.name}" has ${input.layout.length} types but ${input.fieldNames.length} field names`)
  }
  const schema = await schemaPda(input.credential, input.name, input.version ?? 1)
  const w = new Writer()
  w.u8(SAS_INSTRUCTION.createSchema)
    .string(input.name)
    .string(input.description)
    .bytes(Uint8Array.from(input.layout))
  w.u32(input.fieldNames.length)
  for (const field of input.fieldNames) w.string(field)

  return {
    programAddress: SAS_PROGRAM,
    accounts: [
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      meta(input.authority, AccountRole.READONLY_SIGNER),
      meta(input.credential, AccountRole.READONLY),
      meta(schema, AccountRole.WRITABLE),
      meta(SYSTEM_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: w.toBytes(),
  }
}

/**
 * `CreateAttestation` — issue an attestation bound to a nonce (its PDA seed).
 * `data` must already conform to the schema; use `serializeAttestationData`.
 */
export async function createAttestationInstruction(input: {
  payer: string
  authority: string
  credential: string
  schema: string
  nonce: string
  data: ReadonlyUint8Array
  expiry?: bigint | number
}): Promise<Instruction> {
  const attestation = await attestationPda(input.credential, input.schema, input.nonce)
  const w = new Writer()
  w.u8(SAS_INSTRUCTION.createAttestation)
  w.raw(base58Encoder.encode(input.nonce))
  w.bytes(input.data)
  w.i64(input.expiry === undefined ? 0n : BigInt(input.expiry))

  return {
    programAddress: SAS_PROGRAM,
    accounts: [
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      meta(input.authority, AccountRole.READONLY_SIGNER),
      meta(input.credential, AccountRole.READONLY),
      meta(input.schema, AccountRole.READONLY),
      meta(attestation, AccountRole.WRITABLE),
      meta(SYSTEM_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: w.toBytes(),
  }
}
