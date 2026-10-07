/**
 * api/funds-tier.ts — The tier ceiling for policy funds (backend gate)
 *
 * Runs BEFORE any instruction is built: the app posts the requested cover
 * and gets back the device's tier verdict. The contract never learns about
 * tiers — a denied request simply never reaches it.
 *
 *   tier1  $100   base tier
 *   tier2  $250   verified operators — a wallet on `OPERATOR_ALLOWLIST`
 *   tier3  $500   Seeker devices (higher limit for Seeker users)
 *
 * Tier2 is an entitlement, so it is checked against a server-side list
 * rather than anything the client says: `isOperator` is exact membership of
 * `OPERATOR_ALLOWLIST` (env base + the admin console's runtime override),
 * with no wildcard — see `_lib/allowlist.ts` for why. It is independent of
 * the Seeker claim, and a Seeker outranks an operator, so the two combine to
 * whichever ceiling is higher.
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
import { isOperator } from './_lib/allowlist'
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

/** The two claims a request can make — each independently server-checked. */
export interface TierClaim {
  seeker?: boolean
  operator?: boolean
}

/**
 * Which tier this request is judged against. A Seeker outranks an operator;
 * otherwise the operator allowlist is the only thing that lifts a wallet off
 * the base tier. Both flags default false, so a bare call still means
 * "nobody ordinary".
 */
export function tierFor({ seeker = false, operator = false }: TierClaim = {}): FundTierDefinition {
  if (seeker) return FUND_TIERS[2]
  if (operator) return FUND_TIERS[1]
  return FUND_TIERS[0]
}

export interface FundsTierBody {
  amountUsdc: number
  wallet: string
  seeker?: boolean
}

/**
 * Provenance of the `seeker` claim — which gate judged it. Deliberately not
 * the provenance of the *tier*: operator status is a separate field, so a
 * `seeker-rejected` response can still carry `operator: true`.
 */
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
    const wallet = body.wallet.trim()

    // Tier2 is an entitlement, not a claim: exact membership of the
    // operator list, checked here with no RPC and nothing the client said.
    // An unparseable wallet simply cannot match a list of real addresses.
    const operator = isOperator(wallet)

    if (seeker && sgtEnabled()) {
      // The claim was made, so it gets verified — the response will say how.
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
          // Verified and rejected: drop the claim (the operator list, if it
          // lists this wallet, still stands — the two are independent).
          seeker = false
          trust = 'seeker-rejected'
        }
      } catch {
        // Loud failure: an outage must never downgrade anyone silently.
        res.status(503).json({ error: 'Seeker verification temporarily unavailable' })
        return
      }
    }

    const tier = tierFor({ seeker, operator })
    const allowed = body.amountUsdc <= tier.limitUsdc

    res.status(200).json({
      allowed,
      tier: tier.id,
      limitUsdc: tier.limitUsdc,
      amountUsdc: body.amountUsdc,
      seeker,
      operator,
      reason: allowed ? 'within-tier' : 'amount-exceeds-tier-limit',
      trust,
      // The mint is the device identity anti-Sybil logic records.
      ...(mintAddress ? { mintAddress } : {}),
    })
  }
}

export default createFundsTierHandler()
