import { describe, expect, it, vi } from 'vitest'
import { hashEmail, issueEmailAttestation, sasConfigFromEnv, type AttestationIssuer } from '@/api/_lib/sas'

const CONFIG = { issuerSecret: 'secret', credential: 'cred', schema: 'schema' }

describe('sasConfigFromEnv', () => {
  it('returns null until all three env vars are present', () => {
    expect(sasConfigFromEnv({})).toBeNull()
    expect(sasConfigFromEnv({ SAS_ISSUER_SECRET: 's', SAS_CREDENTIAL_PDA: 'c' })).toBeNull()
    expect(sasConfigFromEnv({ SAS_ISSUER_SECRET: 's', SAS_CREDENTIAL_PDA: 'c', SAS_SCHEMA_PDA: 'x' })).toEqual({
      issuerSecret: 's',
      credential: 'c',
      schema: 'x',
      rpcUrl: undefined,
    })
  })

  it('picks up an optional rpc url', () => {
    expect(
      sasConfigFromEnv({ SAS_ISSUER_SECRET: 's', SAS_CREDENTIAL_PDA: 'c', SAS_SCHEMA_PDA: 'x', SAS_RPC_URL: 'r' })
        ?.rpcUrl,
    ).toBe('r')
  })
})

describe('hashEmail', () => {
  it('is a deterministic 64-hex digest', () => {
    expect(hashEmail('grower@example.com')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashEmail('grower@example.com')).toBe(hashEmail('grower@example.com'))
  })

  it('normalizes case and whitespace', () => {
    expect(hashEmail('  Grower@Example.COM ')).toBe(hashEmail('grower@example.com'))
  })

  it('changes with the pepper', () => {
    expect(hashEmail('grower@example.com', 'pep')).not.toBe(hashEmail('grower@example.com'))
  })
})

describe('issueEmailAttestation', () => {
  it('reports not-configured without a config', async () => {
    const outcome = await issueEmailAttestation(
      { subject: 'wallet', email: 'a@b.com', verifiedAt: 1 },
      { config: null },
    )
    expect(outcome).toEqual({ status: 'unavailable', reason: 'not-configured' })
  })

  it('reports issuer-missing when configured but no issuer is wired', async () => {
    const outcome = await issueEmailAttestation(
      { subject: 'wallet', email: 'a@b.com', verifiedAt: 1 },
      { config: CONFIG },
    )
    expect(outcome).toEqual({ status: 'unavailable', reason: 'issuer-missing' })
  })

  it('issues through an injected issuer, hashing the email', async () => {
    const issuer = vi.fn<AttestationIssuer>(async () => ({ attestation: 'att1', signature: 'sig1' }))
    const outcome = await issueEmailAttestation(
      { subject: 'wallet', email: 'a@b.com', verifiedAt: 42 },
      { config: CONFIG, issuer, pepper: 'pep' },
    )

    expect(outcome).toEqual({ status: 'issued', attestation: 'att1', signature: 'sig1' })
    expect(issuer).toHaveBeenCalledWith(
      { subject: 'wallet', emailHash: hashEmail('a@b.com', 'pep'), verifiedAt: 42 },
      CONFIG,
    )
  })

  it('never throws when the issuer fails', async () => {
    const issuer: AttestationIssuer = async () => {
      throw new Error('rpc down')
    }
    const outcome = await issueEmailAttestation(
      { subject: 'wallet', email: 'a@b.com', verifiedAt: 1 },
      { config: CONFIG, issuer },
    )
    expect(outcome).toEqual({ status: 'unavailable', reason: 'issuer-failed' })
  })
})
