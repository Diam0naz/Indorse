/**
 * api/_lib/sas-issuer.ts — the kit-backed `AttestationIssuer`.
 *
 * `api/_lib/sas.ts` owns the env gate and the privacy-preserving email hash but
 * deliberately stops at an injected `AttestationIssuer` so it can be tested
 * without a chain. This module is the real thing: it decodes the issuer key,
 * builds a `CreateAttestation` instruction for the `indorse.email` schema and
 * sends it.
 *
 * The write is one transaction: payer/authority are the issuer wallet (it must
 * be the credential authority or one of its authorized signers), the data is
 * `[emailHash, verifiedAt, "email"]`, and the expiry is 0 (never). The nonce is
 * derived from the subject and the email hash, so a wallet's attestation is
 * deterministic and re-issuing the same (wallet, email) is idempotent — the
 * account already exists and the program rejects the duplicate.
 *
 * Everything here is best-effort by contract: `issueEmailAttestation` swallows
 * a throw and reports `issuer-failed`, because a verified email must never
 * depend on the chain being up.
 */

import { createHash } from 'node:crypto'
import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type ReadonlyUint8Array,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
  type TransactionSigner,
} from '@solana/kit'
import {
  INDORSE_EMAIL_SCHEMA,
  attestationPda,
  createAttestationInstruction,
  serializeAttestationData,
} from '../../lib/program/sas'
import type { ProgramRpc } from '../../lib/program/rpc'
import type { AttestationInput, AttestationIssuer, IssuedAttestation, SasConfig } from './sas'

const DEFAULT_SAS_RPC_URL = 'https://api.devnet.solana.com'

/** `https://` → `wss://`, `http://` → `ws://`. */
function toSubscriptionsUrl(rpcUrl: string): string {
  return rpcUrl.replace(/^http/, 'ws')
}

/** Decode a keypair from base58 or a `[1,2,…]` keygen JSON array. */
function decodeSecretKey(raw: string): ReadonlyUint8Array {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) throw new Error('SAS_ISSUER_SECRET JSON is not an array')
    return Uint8Array.from(parsed as number[])
  }
  return getBase58Encoder().encode(trimmed)
}

async function signerFromSecret(secret: string): Promise<TransactionSigner> {
  const bytes = decodeSecretKey(secret)
  if (bytes.length !== 64) throw new Error(`SAS_ISSUER_SECRET must be 64 bytes, got ${bytes.length}`)
  return createSignerFromKeyPair(await createKeyPairFromBytes(bytes))
}

/**
 * A stable 32-byte nonce for the (wallet, email) pair, encoded as an address.
 * Deterministic so the attestation PDA is the same on every retry, but unique
 * per pair so two emails for one wallet never collide.
 */
export function deriveAttestationNonce(subject: string, emailHash: string): string {
  const digest = createHash('sha256').update(`indorse:attestation:${subject}:${emailHash}`).digest()
  return getBase58Decoder().decode(new Uint8Array(digest))
}

/** Send the attestation transaction and return its address + signature. */
export const kitAttestationIssuer: AttestationIssuer = async (
  input: AttestationInput,
  config: SasConfig,
): Promise<IssuedAttestation> => {
  const signer = await signerFromSecret(config.issuerSecret)
  const owner = signer.address as string
  const rpcUrl = config.rpcUrl ?? DEFAULT_SAS_RPC_URL

  const rpc: ProgramRpc = createSolanaRpc(rpcUrl)
  const rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi> = createSolanaRpcSubscriptions(
    toSubscriptionsUrl(rpcUrl),
  )

  const nonce = deriveAttestationNonce(input.subject, input.emailHash)
  const attestation = await attestationPda(config.credential, config.schema, nonce)
  const data = serializeAttestationData(INDORSE_EMAIL_SCHEMA.layout, [input.emailHash, input.verifiedAt, 'email'])

  const instruction = await createAttestationInstruction({
    payer: owner,
    authority: owner,
    credential: config.credential,
    schema: config.schema,
    nonce,
    data,
    expiry: 0,
  })

  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstruction(instruction, tx),
  )

  const signed = await signTransactionMessageWithSigners(message)
  assertIsTransactionWithBlockhashLifetime(signed)
  assertIsTransactionWithinSizeLimit(signed)

  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, { commitment: 'confirmed' })
  return { attestation, signature: getSignatureFromTransaction(signed) }
}
