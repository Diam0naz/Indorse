/**
 * lib/program/sas.test.ts — the SAS client guard.
 *
 * sas.ts hand-encodes instructions from the SAS IDL because the published
 * `@solana/attestation` client targets kit v8. Nothing else checks that
 * encoding, so this suite restates the wire format independently: the two
 * one-byte discriminators, the account order and roles, the seed literals and
 * the exact PDA addresses, and the byte layout of each argument.
 *
 * A change to sas.ts that drifts from the on-chain program fails here rather
 * than in a transaction that has already paid for a blockhash.
 */

import { describe, expect, it } from 'vitest'
import { AccountRole, address, getBase58Encoder, getProgramDerivedAddress, type ReadonlyUint8Array } from '@solana/kit'
import {
  INDORSE_CREDENTIAL_NAME,
  INDORSE_EMAIL_SCHEMA,
  SAS_INSTRUCTION,
  SAS_PROGRAM_ID,
  SAS_SCHEMA_TYPE,
  SYSTEM_PROGRAM_ID,
  attestationPda,
  createAttestationInstruction,
  createCredentialInstruction,
  createSchemaInstruction,
  credentialPda,
  schemaPda,
  serializeAttestationData,
} from '@/lib/program/sas'

const AUTHORITY = 'AXUTwBhtwbgAJGAZYKHXAJgSo4dMC29XrnbP91BPcYg8'
const PAYER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const SIGNER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const NONCE = '11111111111111111111111111111111'

/** Known-good addresses derived from the seed literals restated below. */
const CREDENTIAL = 'ZcuyBF15y8r3tn3xbyndwAFYaq8wFx3q79mkiU6ZcUZ'
const SCHEMA = 'JBhPUDDyLZfpUw4y736DfzCYPT1C7r7Bge7KYzwMiZbc'
const ATTESTATION = 'FrB6Xo3YTT8bjEtm9buNkkAz9QhYby3GiK3oJjCpBp23'

const base58 = getBase58Encoder()
const encoder = new TextEncoder()

/* ── An independent reader, so the test decodes rather than trusts ────────── */

class Reader {
  private view: DataView
  private offset = 0
  private bytes: ReadonlyUint8Array

  constructor(bytes: ReadonlyUint8Array | undefined) {
    this.bytes = bytes ?? new Uint8Array()
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
  }

  u8(): number {
    return this.view.getUint8(this.offset++)
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  i64(): bigint {
    const value = this.view.getBigInt64(this.offset, true)
    this.offset += 8
    return value
  }

  raw(n: number): ReadonlyUint8Array {
    const out = this.bytes.subarray(this.offset, this.offset + n)
    this.offset += n
    return out
  }

  string(): string {
    return new TextDecoder().decode(this.raw(this.u32()))
  }

  get remaining(): number {
    return this.bytes.length - this.offset
  }
}

describe('SAS program metadata', () => {
  it('points at the published program', () => {
    expect(SAS_PROGRAM_ID).toBe('22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG')
  })

  it('uses the one-byte instruction slots from the IDL', () => {
    expect(SAS_INSTRUCTION.createCredential).toBe(0)
    expect(SAS_INSTRUCTION.createSchema).toBe(1)
    expect(SAS_INSTRUCTION.createAttestation).toBe(6)
  })

  it('uses the documented schema type codes', () => {
    expect(SAS_SCHEMA_TYPE).toMatchObject({ u8: 0, u64: 3, i64: 8, bool: 10, string: 12, vecString: 25 })
  })

  it('describes the email schema as [string, i64, string]', () => {
    expect(INDORSE_EMAIL_SCHEMA.layout).toEqual([12, 8, 12])
    expect(INDORSE_EMAIL_SCHEMA.fieldNames).toEqual(['emailHash', 'verifiedAt', 'method'])
  })
})

describe('PDA finders vs the IDL seed literals', () => {
  async function derive(seeds: ReadonlyUint8Array[]): Promise<string> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: address('22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG'),
      seeds,
    })
    return pda
  }

  it('credential = ["credential", authority, name]', async () => {
    expect(await credentialPda(AUTHORITY, INDORSE_CREDENTIAL_NAME)).toBe(CREDENTIAL)
    expect(await credentialPda(AUTHORITY, INDORSE_CREDENTIAL_NAME)).toBe(
      await derive([encoder.encode('credential'), base58.encode(AUTHORITY), encoder.encode('indorse')]),
    )
  })

  it('schema = ["schema", credential, name, u8(version)]', async () => {
    expect(await schemaPda(CREDENTIAL, INDORSE_EMAIL_SCHEMA.name, 1)).toBe(SCHEMA)
    expect(await schemaPda(CREDENTIAL, INDORSE_EMAIL_SCHEMA.name, 1)).toBe(
      await derive([
        encoder.encode('schema'),
        base58.encode(CREDENTIAL),
        encoder.encode('indorse.email'),
        Uint8Array.of(1),
      ]),
    )
  })

  it('attestation = ["attestation", credential, schema, nonce]', async () => {
    expect(await attestationPda(CREDENTIAL, SCHEMA, NONCE)).toBe(ATTESTATION)
  })

  it('a different schema name or version lands elsewhere', async () => {
    expect(await schemaPda(CREDENTIAL, 'indorse.email', 2)).not.toBe(SCHEMA)
    expect(await schemaPda(CREDENTIAL, 'other', 1)).not.toBe(SCHEMA)
    expect(await credentialPda(AUTHORITY, 'other')).not.toBe(CREDENTIAL)
  })
})

describe('createCredentialInstruction', () => {
  it('orders accounts payer, credential, authority, systemProgram', async () => {
    const ix = await createCredentialInstruction({
      payer: PAYER,
      authority: AUTHORITY,
      name: INDORSE_CREDENTIAL_NAME,
      signers: [AUTHORITY, SIGNER],
    })

    expect(ix.programAddress).toBe(SAS_PROGRAM_ID)
    expect((ix.accounts ?? []).map((a) => [a.address, a.role])).toEqual([
      [PAYER, AccountRole.WRITABLE_SIGNER],
      [CREDENTIAL, AccountRole.WRITABLE],
      [AUTHORITY, AccountRole.READONLY_SIGNER],
      [SYSTEM_PROGRAM_ID, AccountRole.READONLY],
    ])
  })

  it('encodes discriminator, name and the signer vector', async () => {
    const ix = await createCredentialInstruction({
      payer: PAYER,
      authority: AUTHORITY,
      name: INDORSE_CREDENTIAL_NAME,
      signers: [AUTHORITY, SIGNER],
    })

    const r = new Reader(ix.data)
    expect(r.u8()).toBe(SAS_INSTRUCTION.createCredential)
    expect(r.string()).toBe('indorse')
    expect(r.u32()).toBe(2)
    expect(Array.from(r.raw(32))).toEqual(Array.from(base58.encode(AUTHORITY)))
    expect(Array.from(r.raw(32))).toEqual(Array.from(base58.encode(SIGNER)))
    expect(r.remaining).toBe(0)
  })
})

describe('createSchemaInstruction', () => {
  it('orders accounts payer, authority, credential, schema, systemProgram', async () => {
    const ix = await createSchemaInstruction({
      payer: PAYER,
      authority: AUTHORITY,
      credential: CREDENTIAL,
      ...INDORSE_EMAIL_SCHEMA,
    })

    expect((ix.accounts ?? []).map((a) => [a.address, a.role])).toEqual([
      [PAYER, AccountRole.WRITABLE_SIGNER],
      [AUTHORITY, AccountRole.READONLY_SIGNER],
      [CREDENTIAL, AccountRole.READONLY],
      [SCHEMA, AccountRole.WRITABLE],
      [SYSTEM_PROGRAM_ID, AccountRole.READONLY],
    ])
  })

  it('encodes name, description, layout bytes and field names', async () => {
    const ix = await createSchemaInstruction({
      payer: PAYER,
      authority: AUTHORITY,
      credential: CREDENTIAL,
      ...INDORSE_EMAIL_SCHEMA,
    })

    const r = new Reader(ix.data)
    expect(r.u8()).toBe(SAS_INSTRUCTION.createSchema)
    expect(r.string()).toBe('indorse.email')
    expect(r.string()).toBe(INDORSE_EMAIL_SCHEMA.description)
    const layoutBytes = r.raw(r.u32())
    expect(Array.from(layoutBytes)).toEqual([12, 8, 12])
    expect(r.u32()).toBe(3)
    expect([r.string(), r.string(), r.string()]).toEqual(['emailHash', 'verifiedAt', 'method'])
    expect(r.remaining).toBe(0)
  })

  it('refuses a layout whose length disagrees with the field names', async () => {
    await expect(
      createSchemaInstruction({
        payer: PAYER,
        authority: AUTHORITY,
        credential: CREDENTIAL,
        name: 'broken',
        description: '',
        layout: [12, 12],
        fieldNames: ['only'],
      }),
    ).rejects.toThrow(/2 types but 1 field names/)
  })
})

describe('serializeAttestationData', () => {
  it('matches the email schema layout', () => {
    const bytes = serializeAttestationData(INDORSE_EMAIL_SCHEMA.layout, ['abc', 1_700_000_000, 'email'])
    const r = new Reader(bytes)
    expect(r.string()).toBe('abc')
    expect(r.i64()).toBe(1_700_000_000n)
    expect(r.string()).toBe('email')
    expect(r.remaining).toBe(0)
  })

  it('rejects a value count that does not match the layout', () => {
    expect(() => serializeAttestationData([12, 8, 12], ['only'])).toThrow(/3 fields but 1 values/)
  })

  it('rejects a type code it cannot encode', () => {
    expect(() => serializeAttestationData([24], ['x'])).toThrow(/Unsupported SAS schema type code 24/)
  })
})

describe('createAttestationInstruction', () => {
  it('binds the nonce, data and expiry, and derives the attestation PDA', async () => {
    const data = serializeAttestationData(INDORSE_EMAIL_SCHEMA.layout, ['hash', 42, 'email'])
    const ix = await createAttestationInstruction({
      payer: PAYER,
      authority: AUTHORITY,
      credential: CREDENTIAL,
      schema: SCHEMA,
      nonce: NONCE,
      data,
      expiry: 1_800_000_000,
    })

    expect((ix.accounts ?? []).map((a) => [a.address, a.role])).toEqual([
      [PAYER, AccountRole.WRITABLE_SIGNER],
      [AUTHORITY, AccountRole.READONLY_SIGNER],
      [CREDENTIAL, AccountRole.READONLY],
      [SCHEMA, AccountRole.READONLY],
      [ATTESTATION, AccountRole.WRITABLE],
      [SYSTEM_PROGRAM_ID, AccountRole.READONLY],
    ])

    const r = new Reader(ix.data)
    expect(r.u8()).toBe(SAS_INSTRUCTION.createAttestation)
    expect(Array.from(r.raw(32))).toEqual(Array.from(base58.encode(NONCE)))
    expect(Array.from(r.raw(r.u32()))).toEqual(Array.from(data))
    expect(r.i64()).toBe(1_800_000_000n)
    expect(r.remaining).toBe(0)
  })

  it('defaults the expiry to zero (never expires)', async () => {
    const ix = await createAttestationInstruction({
      payer: PAYER,
      authority: AUTHORITY,
      credential: CREDENTIAL,
      schema: SCHEMA,
      nonce: NONCE,
      data: new Uint8Array(),
    })
    const r = new Reader(ix.data)
    r.u8()
    r.raw(32)
    r.raw(r.u32())
    expect(r.i64()).toBe(0n)
  })
})
