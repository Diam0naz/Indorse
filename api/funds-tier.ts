/**
 * api/funds-tier.ts — The tier ceiling for policy funds (backend gate)
 *
 * Runs BEFORE any instruction is built: the app posts the requested cover
 * and gets back the device's tier verdict. The contract never learns about
 * tiers — a denied request simply never reaches it.
 *
 *   tier1  $100   base tier
 *   tier2  $250   reserved — verified operators
 *   tier3  $500   Seeker devices (higher limit for Seeker users)
 *
 * How the `seeker` claim is judged depends on configuration — the response
 * `trust` label always states which happened:
 *
 *   SGT_RPC_URL set      server-side verification through the shared
 *                        `_lib/sgt.ts` module (same check SIWS uses):
 *                        pass  → tier3, `sgt-verified` + `mintAddress`
 *                        fail  → downgraded to tier1, `seeker-rejected`
 *                        error → 503, no verdict (an outage is not a deny)
 *   SGT_RPC_URL unset    legacy dev path — the claim is the app's
 *                        `EXPO_PUBLIC_FORCE_SEEKER` flag, labelled
 *                        `client-asserted-dev` so nothing pretends it was
 *                        verified. Development and tests stay mainnet-free.
 */

import type { ProxyRequest, ProxyResponse } from './_lib/proxy'
import { isValidAddress } from './_lib/address'
import { sgtEnabled, verifySgt, type SgtChecker } from './_lib/sgt'

export interface FundTierDefinition {
  id: 'tier1' | 'tier2' | 'tier3'
  limitUsdc: number
}

/** The ladder itself — whole USDC, one ceiling per tier. */
export const FUND_TIERS: readonly FundTierDefinition[] = [
  { id: 'tier1', limitUsdc: 100 },
  { id: 'tier2', limitUsdc: 250 },
  { id: 'tier3', limitUsdc: 500 },
]

/** Which tier this request is judged against. */
export function tierForSeeker(seeker: boolean): FundTierDefinition {
  // tier2 stays reserved for verified operators until that proof exists.
  return seeker ? FUND_TIERS[2] : FUND_TIERS[0]
}

export interface FundsTierBody {
  amountUsdc: number
  wallet: string
  seeker?: boolean
}

/** Provenance of the tier verdict — which gate produced it. */
export type FundsTierTrust = 'not-seeker' | 'client-asserted-dev' | 'sgt-verified' | 'seeker-rejected'

export interface FundsTierHandlerDeps {
  /** SGT verdict source — defaults to the shared `_lib/sgt` module (env-gated). */
  checkSgt?: SgtChecker
}

export function createFundsTierHandler(deps: FundsTierHandlerDeps = {}) {
  const checkSgt = deps.checkSgt ?? verifySgt

  return async function fundsTier(req: ProxyRequest, res: ProxyResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }
    const body = (req.body ?? {}) as Partial<FundsTierBody>
    if (typeof body.amountUsdc !== 'number' || !Number.isFinite(body.amountUsdc) || body.amountUsdc <= 0) {
      res.status(400).json({ error: 'amountUsdc must be a positive number' })
      return
    }
    if (typeof body.wallet !== 'string' || body.wallet.trim().length === 0) {
      res.status(400).json({ error: 'wallet is required' })
      return
    }

    let seeker = body.seeker === true
    let trust: FundsTierTrust = seeker ? 'client-asserted-dev' : 'not-seeker'
    let mintAddress: string | null = null

    if (seeker && sgtEnabled()) {
      // The claim was made, so it gets verified — the response will say how.
      const wallet = body.wallet.trim()
      if (!isValidAddress(wallet)) {
        res.status(400).json({ error: 'wallet is not a valid address' })
        return
      }
      try {
        const verdict = await checkSgt(wallet)
        if (verdict.hasSGT) {
          trust = 'sgt-verified'
          mintAddress = verdict.mintAddress
        } else {
          // Verified and rejected: keep the base tier, drop the claim.
          seeker = false
          trust = 'seeker-rejected'
        }
      } catch {
        // Loud failure: an outage must never downgrade anyone silently.
        res.status(503).json({ error: 'Seeker verification temporarily unavailable' })
        return
      }
    }

    const tier = tierForSeeker(seeker)
    const allowed = body.amountUsdc <= tier.limitUsdc

    res.status(200).json({
      allowed,
      tier: tier.id,
      limitUsdc: tier.limitUsdc,
      amountUsdc: body.amountUsdc,
      seeker,
      reason: allowed ? 'within-tier' : 'amount-exceeds-tier-limit',
      trust,
      // The mint is the device identity anti-Sybil logic records.
      ...(mintAddress ? { mintAddress } : {}),
    })
  }
}

export default createFundsTierHandler()
