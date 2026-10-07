/**
 * api/siws/verify.ts — verify wallet control, decide entitlement server-side
 *
 * Roadmap #3/#5 (SGT gate, POC shape). Sign-in-with-Solana proves the caller
 * controls the wallet; entitlement is decided here, never in the app, and
 * nothing in this POC moves funds (no on-chain payout).
 *
 * Steps 1–3 (shape → consume nonce → signature over the stored payload) live
 * in `_lib/siws-auth.ts`, shared with the admin routes so the verification
 * order can never drift between them. This handler adds step 4:
 *
 *   4. eligibility — dev allowlist first (`SGT_DEV_ALLOWLIST`, fails closed);
 *      on a miss, when `SGT_RPC_URL` is configured the REAL gate runs: does
 *      the wallet hold a Seeker Genesis Token on mainnet? (`_lib/sgt.ts` —
 *      the same shared module `/api/funds-tier` uses.) An RPC outage
 *      answers 503 — never a fake "not eligible".
 *
 *   POST /api/siws/verify
 *   { address, nonce, signature: number[64], signedMessage: number[] }
 *   → 200 { verified: true,  address, method: 'allowlist' }
 *   → 200 { verified: true,  address, method: 'sgt', mintAddress }
 *   → 200 { verified: false, address, reason: 'not-allowlisted' | 'no-sgt' }
 *   → 400 malformed input · 401 unknown/reused nonce or bad signature
 *   → 503 SGT configured but the mainnet RPC is unreachable
 *
 * Env:
 *   SGT_DEV_ALLOWLIST — comma-separated base58 addresses; '*' allows any
 *                       SIWS-verified wallet — development/demo fast path
 *                       ahead of the real SGT gate. May also be overridden
 *                       at runtime by the admin console (see
 *                       `_lib/allowlist.ts` for the layering).
 *   SGT_RPC_URL       — mainnet endpoint; SET enables the SGT gate behind an
 *                       allowlist miss. Unset keeps legacy deny behaviour so
 *                       development/tests never depend on mainnet.
 */

import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'
import { verifySignInBody } from '../_lib/siws-auth'
import { allowlistEntries, isEligible } from '../_lib/allowlist'
import { sgtEnabled, verifySgt, type SgtChecker } from '../_lib/sgt'

export { isEligible, allowlistEntries }

export interface VerifyHandlerDeps {
  /** SGT verdict source — defaults to the shared `_lib/sgt` module (env-gated). */
  checkSgt?: SgtChecker
}

export function createVerifyHandler(deps: VerifyHandlerDeps = {}) {
  const checkSgt = deps.checkSgt ?? verifySgt

  return async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
    if (req.method && req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const auth = verifySignInBody(parseBody(req.body))
    if (!auth.ok) {
      res.status(auth.status).json(auth.error)
      return
    }

    // ── 4. Eligibility ────────────────────────────────────────────────
    if (isEligible(auth.address)) {
      res.status(200).json({ verified: true, address: auth.address, method: 'allowlist' })
      return
    }

    // The allowlist said no. With SGT verification configured, the real
    // gate runs now — a deny here means "this wallet holds no SGT".
    if (!sgtEnabled()) {
      res.status(200).json({ verified: false, address: auth.address, reason: 'not-allowlisted' })
      return
    }

    try {
      const { hasSGT, mintAddress } = await checkSgt(auth.address)
      if (!hasSGT) {
        res.status(200).json({ verified: false, address: auth.address, reason: 'no-sgt' })
        return
      }
      res.status(200).json({ verified: true, address: auth.address, method: 'sgt', mintAddress })
    } catch {
      // Loud failure: an outage must never read as "not a Seeker".
      res.status(503).json({ error: 'Verification temporarily unavailable.' })
    }
  }
}

export default createVerifyHandler()
