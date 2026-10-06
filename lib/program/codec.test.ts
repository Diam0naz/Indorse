/**
 * lib/program/codec.test.ts — Borsh round trips against the IDL.
 *
 * Every value here has a fixed expected layout, so these tests catch both
 * codec regressions (endianness, string prefixes, enum bytes) and IDL drift
 * (a re-sync that changes field order or discriminators).
 */

import { describe, expect, it } from 'vitest'
import { decodeAccount, decodeInstructionArgs, encodeAccount, encodeInstruction } from '@/lib/program/codec'
import { accountDiscriminator, instructionDiscriminator } from '@/lib/program/idl'

const OWNER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const OTHER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

describe('instruction encoding', () => {
  it('round-trips register_farm args', () => {
    const args = { name: 'Green Valley', latE6: 46_882_100, lngE6: -98_702_300 }
    const data = encodeInstruction('register_farm', args)

    // 8 discriminator + (4 + 12) name + 8 lat + 8 lng
    expect(data).toHaveLength(40)
    expect(Array.from(data.slice(0, 8))).toEqual(Array.from(instructionDiscriminator('register_farm')))
    expect(decodeInstructionArgs(data, 'register_farm')).toEqual(args)
  })

  it('round-trips submit_scout_report args including a [u8; 32] hash', () => {
    const photoHash = Array.from({ length: 32 }, (_, i) => (i * 7) % 256)
    const args = {
      photoHash,
      uri: 'https://cdn.indorse.app/scout/1758000000000.jpg',
      latE6: 46_882_100,
      lngE6: -98_702_300,
      aiLabel: 'Downy Mildew',
    }
    const data = encodeInstruction('submit_scout_report', args)

    expect(Array.from(data.slice(0, 8))).toEqual(Array.from(instructionDiscriminator('submit_scout_report')))
    expect(decodeInstructionArgs(data, 'submit_scout_report')).toEqual(args)
  })

  it('encodes i64 coordinates little-endian', () => {
    const data = encodeInstruction('register_farm', { name: 'X', latE6: 1, lngE6: -1 })
    // disc(8) + len(4) + 'X'(1) + lat(8) → lng starts at byte 21
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    expect(view.getBigInt64(13, true)).toBe(1n)
    expect(view.getBigInt64(21, true)).toBe(-1n)
  })

  it('rejects a missing argument with the IDL field name', () => {
    expect(() => encodeInstruction('register_farm', { name: 'X', latE6: 1 })).toThrow(/Missing argument "lngE6"/)
  })

  it('rejects a wrong-length photo hash', () => {
    expect(() =>
      encodeInstruction('submit_scout_report', {
        photoHash: [1, 2, 3],
        uri: 'x',
        latE6: 0,
        lngE6: 0,
        aiLabel: 'x',
      }),
    ).toThrow(/expects 32 bytes/)
  })

  it('names lib/idl in unknown-instruction errors', () => {
    expect(() => encodeInstruction('mint_token', {})).toThrow(/npm run idl:sync/)
  })
})

describe('account encoding', () => {
  const farm = {
    owner: OWNER,
    name: 'Green Valley',
    latE6: 46_882_100,
    lngE6: -98_702_300,
    reportCount: 2,
    batchCount: 0,
    verifiedReportCount: 1,
    policyCount: 0,
    index: 4,
    bump: 254,
  }

  it('round-trips a Farm account', () => {
    const data = encodeAccount('Farm', farm)
    // 8 disc + 32 owner + (4 + 12) name + 8 + 8 + 5×4 counters/index + 1 bump
    expect(data).toHaveLength(93)
    expect(Array.from(data.slice(0, 8))).toEqual(Array.from(accountDiscriminator('Farm')))
    expect(decodeAccount(data, 'Farm')).toEqual(farm)
  })

  it('round-trips a ScoutReport in every status', () => {
    for (const status of ['pending', 'verified', 'rejected', 'rewarded']) {
      const report = {
        farm: OTHER,
        reporter: OWNER,
        index: 3,
        photoHash: Array.from({ length: 32 }, (_, i) => i),
        uri: 'https://cdn.indorse.app/scout/abc.jpg',
        latE6: -33_868_800,
        lngE6: 151_209_400,
        aiLabel: 'Late Blight',
        status,
        verifier: OTHER,
        timestamp: 1_758_100_000,
        bump: 251,
      }
      const data = encodeAccount('ScoutReport', report)
      expect(decodeAccount(data, 'ScoutReport')).toEqual(report)
    }
  })

  it('throws on a discriminator mismatch instead of decoding garbage', () => {
    expect(() => decodeAccount(new Uint8Array(89), 'Farm')).toThrow(/Discriminator mismatch/)
  })

  it('rejects a truncated account', () => {
    expect(() => decodeAccount(accountDiscriminator('Farm'), 'Farm')).toThrow(/too short|truncated/i)
  })
})
