/**
 * lib/program/codec.ts — IDL-driven borsh encoder/decoder.
 *
 * Borsh layout rules used here (matching Anchor's Rust side):
 *   - fixed-width ints little-endian (u8/u16/u32/u64, i64)
 *   - `bool` as one byte (0/1)
 *   - `string` = u32 LE byte length + UTF-8 bytes
 *   - `[u8; N]` raw bytes, no length prefix
 *   - unit-variant enums as one byte (variant index)
 *   - `option` = 0x00 | 0x01 + value, `vec` = u32 length + items
 *   - structs are field-ordered concatenation, no padding
 *
 * Account data begins with the 8-byte discriminator from the IDL, then the
 * struct fields. Instruction data begins with the instruction discriminator.
 *
 * Numbers: u64/i64 are decoded to `Number` (safe to 2^53 — every value this
 * app touches: timestamps, E6 coordinates, USDC amounts at 6dp). Encoding
 * accepts `number | bigint | string` and converts through `BigInt`.
 *
 * Keys: decoded structs use camelCase (`report_count` → `reportCount`);
 * encoding args accepts camelCase and maps back to the IDL names.
 */

import { getBase58Encoder, getBase58Decoder, type ReadonlyUint8Array } from '@solana/kit'
import {
  accountDiscriminator,
  instructionDef,
  snakeToCamel,
  typeDef,
  valueToVariant,
  variantToValue,
  type IdlInstruction,
  type IdlType,
} from './idl'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const base58Encoder = getBase58Encoder()
const base58Decoder = getBase58Decoder()

/* ── Writer ────────────────────────────────────────────────────────────────── */

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

  u8(value: number): void {
    this.ensure(1)
    this.view.setUint8(this.len, value)
    this.len += 1
  }

  u16(value: number): void {
    this.ensure(2)
    this.view.setUint16(this.len, value, true)
    this.len += 2
  }

  u32(value: number): void {
    this.ensure(4)
    this.view.setUint32(this.len, value, true)
    this.len += 4
  }

  u64(value: bigint): void {
    this.ensure(8)
    this.view.setBigUint64(this.len, value, true)
    this.len += 8
  }

  i64(value: bigint): void {
    this.ensure(8)
    this.view.setBigInt64(this.len, value, true)
    this.len += 8
  }

  raw(bytes: ReadonlyUint8Array): void {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.len)
    this.len += bytes.length
  }

  string(value: string): void {
    const bytes = textEncoder.encode(value)
    this.u32(bytes.length)
    this.raw(bytes)
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/* ── Reader ────────────────────────────────────────────────────────────────── */

class Reader {
  private view: DataView
  offset: number

  constructor(
    private bytes: ReadonlyUint8Array,
    offset = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.offset = offset
  }

  private take(n: number): number {
    if (this.offset + n > this.bytes.length) throw new Error('Account data truncated — IDL/layout mismatch?')
    const at = this.offset
    this.offset += n
    return at
  }

  u8(): number {
    return this.view.getUint8(this.take(1))
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true)
  }

  u32(): number {
    return this.view.getUint32(this.take(4), true)
  }

  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true)
  }

  i64(): bigint {
    return this.view.getBigInt64(this.take(8), true)
  }

  raw(n: number): Uint8Array {
    const at = this.take(n)
    return this.bytes.subarray(at, at + n)
  }

  string(): string {
    const size = this.u32()
    return textDecoder.decode(this.raw(size))
  }
}

/* ── Value encoding ────────────────────────────────────────────────────────── */

function asInt(value: unknown, type: string, field: string): bigint {
  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') {
    throw new Error(`Expected an integer for "${field}" (${type}), got ${typeof value}`)
  }
  const asBig = BigInt(value)
  return asBig
}

function writeValue(w: Writer, value: unknown, type: IdlType, field: string): void {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8':
        w.u8(Number(value))
        return
      case 'u16':
        w.u16(Number(value))
        return
      case 'u32':
        w.u32(Number(value))
        return
      case 'u64':
        w.u64(asInt(value, type, field))
        return
      case 'i64':
        w.i64(asInt(value, type, field))
        return
      case 'bool':
        w.u8(value ? 1 : 0)
        return
      case 'string':
        w.string(String(value))
        return
      case 'pubkey': {
        const bytes = base58Encoder.encode(String(value))
        if (bytes.length !== 32) throw new Error(`"${field}" is not a 32-byte address`)
        w.raw(bytes)
        return
      }
      default:
        throw new Error(`Unsupported IDL type "${String(type)}" for "${field}"`)
    }
  }
  if ('array' in type) {
    const [kind, size] = type.array
    if (kind !== 'u8') throw new Error(`Unsupported array element type "${kind}" for "${field}"`)
    const bytes = Uint8Array.from(value as ArrayLike<number>)
    if (bytes.length !== size) throw new Error(`"${field}" expects ${size} bytes, got ${bytes.length}`)
    w.raw(bytes)
    return
  }
  if ('option' in type) {
    if (value === null || value === undefined) {
      w.u8(0)
      return
    }
    w.u8(1)
    writeValue(w, value, type.option, field)
    return
  }
  if ('vec' in type) {
    const items = value as unknown[]
    w.u32(items.length)
    for (const item of items) writeValue(w, item, type.vec, field)
    return
  }
  if ('defined' in type) {
    const def = typeDef(type.defined.name).type
    if (def.kind === 'enum') {
      const name = valueToVariant(String(value))
      const index = def.variants.findIndex((v) => v.name === name)
      if (index < 0) throw new Error(`Unknown ${type.defined.name} variant "${String(value)}" for "${field}"`)
      w.u8(index)
      return
    }
    const struct = value as Record<string, unknown>
    for (const f of def.fields) writeValue(w, struct[snakeToCamel(f.name)], f.type, `${field}.${f.name}`)
    return
  }
  throw new Error(`Unsupported IDL type for "${field}"`)
}

/* ── Value decoding ────────────────────────────────────────────────────────── */

function readValue(r: Reader, type: IdlType): unknown {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8':
        return r.u8()
      case 'u16':
        return r.u16()
      case 'u32':
        return r.u32()
      case 'u64':
        return Number(r.u64())
      case 'i64':
        return Number(r.i64())
      case 'bool':
        return r.u8() === 1
      case 'string':
        return r.string()
      case 'pubkey':
        return base58Decoder.decode(r.raw(32))
      default:
        throw new Error(`Unsupported IDL type "${String(type)}"`)
    }
  }
  if ('array' in type) {
    const [kind, size] = type.array
    if (kind !== 'u8') throw new Error(`Unsupported array element type "${kind}"`)
    return Array.from(r.raw(size))
  }
  if ('option' in type) {
    return r.u8() === 0 ? null : readValue(r, type.option)
  }
  if ('vec' in type) {
    const count = r.u32()
    const out: unknown[] = []
    for (let i = 0; i < count; i += 1) out.push(readValue(r, type.vec))
    return out
  }
  if ('defined' in type) {
    const def = typeDef(type.defined.name).type
    if (def.kind === 'enum') {
      const index = r.u8()
      const variant = def.variants[index]
      if (!variant) throw new Error(`Invalid ${type.defined.name} variant index ${index}`)
      return variantToValue(variant.name)
    }
    const out: Record<string, unknown> = {}
    for (const f of def.fields) out[snakeToCamel(f.name)] = readValue(r, f.type)
    return out
  }
  throw new Error('Unsupported IDL type')
}

/* ── Public API ────────────────────────────────────────────────────────────── */

/** Encode instruction data: 8-byte discriminator + args (camelCase keys in). */
export function encodeInstructionArgs(ix: IdlInstruction, args: Record<string, unknown>): Uint8Array {
  const w = new Writer()
  w.raw(Uint8Array.from(ix.discriminator))
  for (const field of ix.args) {
    const key = snakeToCamel(field.name)
    if (!(key in args)) throw new Error(`Missing argument "${key}" for instruction ${ix.name}`)
    writeValue(w, args[key], field.type, key)
  }
  return w.toBytes()
}

/** Encode `register_farm`-style instruction data from its name. */
export function encodeInstruction(name: string, args: Record<string, unknown>): Uint8Array {
  return encodeInstructionArgs(instructionDef(name), args)
}

/**
 * Encode a full account: 8-byte discriminator + struct fields (camelCase keys).
 * Primarily used by tests to fabricate chain data; the app only decodes.
 */
export function encodeAccount(name: string, value: Record<string, unknown>): Uint8Array {
  const def = typeDef(name).type
  if (def.kind !== 'struct') throw new Error(`"${name}" is not a struct`)
  const w = new Writer()
  w.raw(accountDiscriminator(name))
  for (const f of def.fields) {
    const key = snakeToCamel(f.name)
    if (!(key in value)) throw new Error(`Missing field "${key}" for account ${name}`)
    writeValue(w, value[key], f.type, key)
  }
  return w.toBytes()
}

/**
 * Decode account data → camelCase object. Throws when the 8-byte discriminator
 * does not match `accountName` (wrong account type or stale IDL).
 */
export function decodeAccount<T = Record<string, unknown>>(data: ReadonlyUint8Array, accountName: string): T {
  const disc = accountDiscriminator(accountName)
  if (data.length < 8) throw new Error(`"${accountName}" data too short (${data.length} bytes)`)
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== disc[i]) throw new Error(`Discriminator mismatch — this is not a ${accountName} account`)
  }
  const def = typeDef(accountName).type
  if (def.kind !== 'struct') throw new Error(`"${accountName}" is not a struct`)
  const r = new Reader(data, 8)
  const out: Record<string, unknown> = {}
  for (const f of def.fields) out[snakeToCamel(f.name)] = readValue(r, f.type)
  return out as T
}

/** Decode instruction data back to camelCase args (tests / debugging). */
export function decodeInstructionArgs(data: ReadonlyUint8Array, name: string): Record<string, unknown> {
  const ix = instructionDef(name)
  if (data.length < 8) throw new Error('Instruction data too short')
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== ix.discriminator[i]) throw new Error(`Discriminator mismatch for instruction ${name}`)
  }
  const r = new Reader(data, 8)
  const out: Record<string, unknown> = {}
  for (const f of ix.args) out[snakeToCamel(f.name)] = readValue(r, f.type)
  return out
}
