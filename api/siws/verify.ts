/**
 * api/siws/verify.ts — verify wallet control, gate on the dev allowlist
 *
 * Roadmap #3/#5 (SGT gate, POC shape). Sign-in-with-Solana proves the caller
 * controls the wallet; eligibility is a server-side dev allowlist. The real
 * "wallet holds an SGT" mainnet check slots in behind the same `isEligible`
 * seam later — entitlement is decided here, never in the app, and nothing in
 * this POC moves funds (no on-chain payout).
 *
 * Steps 1–3 (shape → consume nonce → signature over the stored payload) live
 * in `_lib/siws-auth.ts`, shared with the admin routes so the verification
 * order can never drift between them. This handler adds step 4:
 *
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
 *                       server-side SGT check replaces this later. May also
 *                       be overridden at runtime by the admin console
 *                       (see `_lib/allowlist.ts` for the layering).
 */

import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'
import { verifySignInBody } from '../_lib/siws-auth'
import { allowlistEntries, isEligible } from '../_lib/allowlist'

export { isEligible, allowlistEntries }

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = verifySignInBody(parseBody(req.body))
  if (!auth.ok) {
    res.status(auth.status).json(auth.error)
    return
  }

  // ── 4. Eligibility — allowlist today, SGT on-chain check later ───────
  if (!isEligible(auth.address)) {
    res.status(200).json({ verified: false, address: auth.address, reason: 'not-allowlisted' })
    return
  }

  res.status(200).json({ verified: true, address: auth.address, method: 'allowlist' })
}
