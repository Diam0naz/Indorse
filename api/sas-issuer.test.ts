/**
 * api/sas-issuer.test.ts — the deterministic nonce behind each attestation.
 *
 * The nonce is the only part of the issuer that is pure logic, so it is the
 * only part worth pinning: a stable, 32-byte, address-encoded value that
 * changes with the wallet and the email hash. Everything after it is a
 * transaction assembled from `lib/program/sas.ts`, already covered there.
 */

import { describe, expect, it } from 'vitest'
import { getBase58Encoder } from '@solana/kit'
import { deriveAttestationNonce } from '@/api/_lib/sas-issuer'

const HASH = 'a'.repeat(64)

describe('deriveAttestationNonce', () => {
  it('is deterministic for the same (wallet, email) pair', () => {
    expect(deriveAttestationNonce('wallet1', HASH)).toBe(deriveAttestationNonce('wallet1', HASH))
  })

  it('decodes to 32 bytes, so it is a valid PDA seed', () => {
    expect(getBase58Encoder().encode(deriveAttestationNonce('wallet1', HASH)).length).toBe(32)
  })

  it('differs by wallet and by email hash', () => {
    expect(deriveAttestationNonce('wallet1', HASH)).not.toBe(deriveAttestationNonce('wallet2', HASH))
    expect(deriveAttestationNonce('wallet1', HASH)).not.toBe(deriveAttestationNonce('wallet1', 'b'.repeat(64)))
  })
})
