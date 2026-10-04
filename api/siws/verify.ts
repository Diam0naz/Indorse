/**
 * api/siws/verify.ts — verify wallet control, gate on the dev allowlist
 *
 * Roadmap #3/#5 (SGT gate, POC shape). Sign-in-with-Solana proves the caller
 * controls the wallet; eligibility is a server-side dev allowlist. The real
 * "wallet holds an SGT" mainnet check slots in behind the same `isEligible`
 * seam later — entitlement is decided here, never in the app, and nothing in
 * this POC moves funds (no on-chain payout).
 *
 * Order matters; every input is attacker-chosen:
 *   1. shape checks — reject before touching the store or the ed25519 verify
 *   2. consume the nonce — single-use; unknown/expired/replayed → 401
 *   3. verify the signature against the STORED payload, with the public key
 *      derived from the address being acted on. `verifySignIn` never binds
 *      key to address itself, so taking the key from the request body would
 *      let any throwaway keypair sign a message naming any address.
 *   4. eligibility — allowlist match (or '*' in development)
 *
 *   POST /api/siws/verify
 *   { address, nonce, signature: number[64], signedMessage: number[] }
 *   → 200 { verified: true,  address, method: 'allowlist' }
 *   → 200 { verified: false, address, reason: 'not-allowlisted' }
 *   → 400 malformed input · 401 unknown/reused nonce or bad signature
 *
 * Env:
 *   SGT_DEV_ALLOWLIST — comma-separated base58 addresses. '*' allows any
 *                       SIWS-verified wallet — development/demo ONLY; the
 *                       server-side SGT check replaces this later.
 */

import { getBase58Encoder } from '@solana/kit'
import { verifySignIn } from '@solana/wallet-standard-util'
import { siwsStore } from '../_lib/siws-store'
import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'

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

/**
 * Dev allowlist gate. Reads `SGT_DEV_ALLOWLIST` per call so operators can
 * rotate the list without a redeploy. Empty/missing denies everything —
 * failing closed is the only safe default for an entitlement check.
 */
export function isEligible(address: string): boolean {
  const raw = (process.env.SGT_DEV_ALLOWLIST ?? '').trim()
  if (raw.length === 0) return false
  if (raw === '*') return true // development/demo only
  return raw.split(',').some((entry) => entry.trim() === address)
}

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body)
  const { address, nonce, signature, signedMessage } = body as {
    address?: unknown
    nonce?: unknown
    signature?: unknown
    signedMessage?: unknown
  }

  // ── 1. Shape — one clear answer for every garbage input ──────────────
  if (typeof address !== 'string' || typeof nonce !== 'string') {
    res.status(400).json({ error: 'address and nonce are required' })
    return
  }
  const publicKey = decodePublicKey(address)
  if (!publicKey) {
    res.status(400).json({ error: 'Malformed address.' })
    return
  }
  if (
    !Array.isArray(signature) ||
    signature.length !== 64 ||
    !signature.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    res.status(400).json({ error: 'Malformed signature.' })
    return
  }
  if (!Array.isArray(signedMessage) || !signedMessage.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    res.status(400).json({ error: 'Malformed signed message.' })
    return
  }

  // ── 2. Consume the nonce — unknown, expired and replayed all fail ────
  const issued = siwsStore.consume(nonce)
  if (!issued) {
    res.status(401).json({ error: 'Invalid, reused, or expired nonce.', code: 'nonce' })
    return
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
    res.status(401).json({ error: 'Invalid signature.', code: 'signature' })
    return
  }

  // ── 4. Eligibility — allowlist today, SGT on-chain check later ───────
  if (!isEligible(address)) {
    res.status(200).json({ verified: false, address, reason: 'not-allowlisted' })
    return
  }

  res.status(200).json({ verified: true, address, method: 'allowlist' })
}
