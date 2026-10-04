/**
 * api/_lib/sas.ts — Solana Attestation Service seam (email verification)
 *
 * The durable proof that "this wallet controls this email" is meant to be an
 * SAS attestation bound to the wallet. This module holds everything around
 * that write — the env gate, the privacy-preserving email hash, and the
 * issuer seam — so the route stays clean and the pieces stay testable.
 *
 * WHY THE ON-CHAIN WRITE IS INJECTED
 * The SAS TypeScript client (`@solana/attestation`) targets `@solana/kit` v8;
 * this app is pinned to `@solana/kit` v7. Rather than force a version bump
 * through the whole app for one POC feature, the actual `CreateAttestation`
 * send is modelled as an injectable `AttestationIssuer`. Deploy-time wires the
 * SDK-backed issuer (see `scripts/bootstrap-sas.mjs`); tests inject a fake.
 * Until an issuer is provided, issuance reports `issuer-missing` and email
 * verification still succeeds — a verified email never depends on the chain.
 *
 * PRIVACY: only a salted SHA-256 hash of the address ever reaches a schema
 * field. The raw email is never stored on-chain and never leaves this process
 * beyond the provider send.
 *
 * Env (all three required to enable issuance):
 *   SAS_ISSUER_SECRET   — base58 secret key of a credential-authorized signer
 *   SAS_CREDENTIAL_PDA  — the app's Credential account
 *   SAS_SCHEMA_PDA      — the "indorse.email" Schema account
 *   SAS_RPC_URL         — optional; defaults to the app's cluster
 *   SAS_EMAIL_PEPPER    — optional; hardens the email hash against enumeration
 */

import { createHash } from 'node:crypto'

export interface SasConfig {
  issuerSecret: string
  credential: string
  schema: string
  rpcUrl?: string
}

export type SasUnavailableReason = 'not-configured' | 'issuer-missing' | 'issuer-failed'

export type SasOutcome =
  { status: 'issued'; attestation: string; signature: string } | { status: 'unavailable'; reason: SasUnavailableReason }

/** What the issuer receives — the raw email is deliberately not part of it. */
export interface AttestationInput {
  /** Wallet the attestation is bound to (the subject). */
  subject: string
  /** Salted SHA-256 hex of the normalized email. */
  emailHash: string
  /** Unix seconds. */
  verifiedAt: number
}

export interface IssuedAttestation {
  /** Attestation account address. */
  attestation: string
  /** Transaction signature that wrote it. */
  signature: string
}

/** The SDK-backed write. Injected so the POC needs no kit-v8 dependency. */
export type AttestationIssuer = (input: AttestationInput, config: SasConfig) => Promise<IssuedAttestation>

/** Read the SAS gate from the environment. Returns null unless fully configured. */
export function sasConfigFromEnv(env: Record<string, string | undefined> = process.env): SasConfig | null {
  const issuerSecret = env.SAS_ISSUER_SECRET?.trim()
  const credential = env.SAS_CREDENTIAL_PDA?.trim()
  const schema = env.SAS_SCHEMA_PDA?.trim()
  if (!issuerSecret || !credential || !schema) return null
  return { issuerSecret, credential, schema, rpcUrl: env.SAS_RPC_URL?.trim() || undefined }
}

/** Salted SHA-256 of the normalized email — the only form that leaves here. */
export function hashEmail(email: string, pepper = ''): string {
  return createHash('sha256').update(`${pepper.trim()}:${email.trim().toLowerCase()}`).digest('hex')
}

/**
 * Issue the "email verified" attestation, or explain why it did not happen.
 * Never throws: a chain hiccup must not undo an email that was already proven.
 */
export async function issueEmailAttestation(
  input: { subject: string; email: string; verifiedAt: number },
  options: { config: SasConfig | null; issuer?: AttestationIssuer; pepper?: string },
): Promise<SasOutcome> {
  if (!options.config) return { status: 'unavailable', reason: 'not-configured' }
  if (!options.issuer) return { status: 'unavailable', reason: 'issuer-missing' }

  const emailHash = hashEmail(input.email, options.pepper)
  try {
    const { attestation, signature } = await options.issuer(
      { subject: input.subject, emailHash, verifiedAt: input.verifiedAt },
      options.config,
    )
    return { status: 'issued', attestation, signature }
  } catch {
    return { status: 'unavailable', reason: 'issuer-failed' }
  }
}
