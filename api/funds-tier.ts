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
 * The `seeker` claim is client-asserted in the POC (the app's dev flag);
 * the response labels it `client-asserted-dev` so nothing pretends it was
 * verified. Server-side SGT verification slots into this same handler.
 */

import type { ProxyRequest, ProxyResponse } from './_lib/proxy'

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

export default async function fundsTier(req: ProxyRequest, res: ProxyResponse): Promise<void> {
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

  const seeker = body.seeker === true
  const tier = tierForSeeker(seeker)
  const allowed = body.amountUsdc <= tier.limitUsdc

  res.status(200).json({
    allowed,
    tier: tier.id,
    limitUsdc: tier.limitUsdc,
    amountUsdc: body.amountUsdc,
    seeker,
    reason: allowed ? 'within-tier' : 'amount-exceeds-tier-limit',
    // Honest provenance of the Seeker claim — dev flag, not verified SGT.
    trust: seeker ? 'client-asserted-dev' : 'not-seeker',
  })
}
