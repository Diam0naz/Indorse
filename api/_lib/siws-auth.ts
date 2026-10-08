/**
 * api/_lib/siws-auth.ts — shared SIWS request verification (steps 1–3)
 *
 * The order matters and every input is attacker-chosen, so it lives in one
 * place used by both `/api/siws/verify` and the admin routes:
 *
 *   1. shape checks — reject before touching the store or the ed25519 verify
 *   2. consume the nonce — single-use; unknown/expired/replayed → 401
 *   3. verify the signature against the STORED payload, with the public key
 *      derived from the address being acted on. `verifySignIn` never binds
 *      key to address itself, so taking the key from the request body would
 *      let any throwaway keypair sign a message naming any address.
 *
 * Nothing here is synchronous any more: step 2 consumes the nonce through
 * `_lib/siws-store.ts`, whose shared (Redis) backend is async so a
 * multi-instance deployment burns the nonce exactly once across instances.
 *
 * Step 4 (eligibility) stays with the caller: the sign-in route checks the
 * dev allowlist; the admin routes skip it and check `config.admin` on-chain
 * instead — protocol authority is not entitlement.
 */

import { getBase58Encoder } from '@solana/kit'
import { verifySignIn } from '@solana/wallet-standard-util'
import { siwsStore } from './siws-store'

type Base58Bytes = ReturnType<ReturnType<typeof getBase58Encoder>['encode']>

/** The 32-byte key inside a base58 address — null when the address is malformed. */
function decodePublicKey(address: string): Base58Bytes | null {
  try {
    const bytes = getBase58Encoder().encode(address)
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

export type SiwsAuthFailure = { ok: false; status: number; error: { error: string; code?: string } }
export type SiwsAuthResult = { ok: true; address: string } | SiwsAuthFailure

/**
 * Verifies `{ address, nonce, signature, signedMessage }` against the stored
 * nonce payload. Success returns the proven address; failure carries the HTTP
 * status and body the caller should answer with verbatim (the shapes are the
 * existing `/api/siws/verify` contract).
 */
export async function verifySignInBody(body: unknown): Promise<SiwsAuthResult> {
  const { address, nonce, signature, signedMessage } = body as {
    address?: unknown
    nonce?: unknown
    signature?: unknown
    signedMessage?: unknown
  }

  // ── 1. Shape — one clear answer for every garbage input ──────────────
  if (typeof address !== 'string' || typeof nonce !== 'string') {
    return { ok: false, status: 400, error: { error: 'address and nonce are required' } }
  }
  const publicKey = decodePublicKey(address)
  if (!publicKey) {
    return { ok: false, status: 400, error: { error: 'Malformed address.' } }
  }
  if (
    !Array.isArray(signature) ||
    signature.length !== 64 ||
    !signature.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    return { ok: false, status: 400, error: { error: 'Malformed signature.' } }
  }
  if (!Array.isArray(signedMessage) || !signedMessage.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return { ok: false, status: 400, error: { error: 'Malformed signed message.' } }
  }

  // ── 2. Consume the nonce — unknown, expired and replayed all fail ────
  const issued = await siwsStore.consume(nonce)
  if (!issued) {
    return { ok: false, status: 401, error: { error: 'Invalid, reused, or expired nonce.', code: 'nonce' } }
  }

  // ── 3. Signature over the stored payload, key derived from `address` ─
  let valid: boolean
  try {
    valid = verifySignIn(
      { ...issued, address },
      {
        account: { address, chains: [], features: [], publicKey },
        signature: new Uint8Array(signature),
        signedMessage: new Uint8Array(signedMessage),
      },
    )
  } catch {
    valid = false
  }
  if (!valid) {
    return { ok: false, status: 401, error: { error: 'Invalid signature.', code: 'signature' } }
  }

  return { ok: true, address }
}
