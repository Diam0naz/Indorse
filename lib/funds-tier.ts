/**
 * lib/funds-tier.ts — Tiered access to policy funds, checked before the
 * instruction exists.
 *
 * The contract has no notion of tiers (and this feature deliberately does
 * not add one): the ceiling is enforced here, ahead of the wallet prompt,
 * by asking the backend (`POST /api/funds-tier`) whether this amount fits
 * this device's tier. Nothing over-limit is ever built, simulated or sent.
 *
 *   tier1  $100   base tier
 *   tier2  $250   verified operators — the server's `OPERATOR_ALLOWLIST`
 *   tier3  $500   Seeker devices
 *
 * Configuration:
 *   EXPO_PUBLIC_FUND_TIER_URL  set  → the gate is enforced (fail-closed:
 *                                      an unreachable/malformed answer
 *                                      throws, so no instruction is built)
 *                             unset → dev default is open with
 *                                      reason 'tier-gate-not-configured'
 *
 * `seeker` is a *request*, not a fact: the client asks, the server verifies
 * (shared `_lib/sgt` check when `SGT_RPC_URL` is set) and answers with the
 * whole verdict. `operator` is never sent by the client at all — it comes
 * back only, because tier2 is a server-side entitlement. The response keeps
 * every label the server sent (`trust`, `mintAddress`, `operator`) rather
 * than only what the pre-submit check needs, so a caller can tell a verified
 * Seeker from a dev-asserted one.
 *
 *   trust: 'sgt-verified'       SGT check passed (mainnet)
 *          'seeker-rejected'    SGT check failed — dropped to base/operator
 *          'client-asserted-dev'  check not configured (dev / tests)
 *          'not-seeker'         no claim made
 */

export type FundTierId = 'tier1' | 'tier2' | 'tier3'

/**
 * Which gate judged the `seeker` claim. Mirrors `api/funds-tier.ts`'s
 * `FundsTierTrust` — app code never imports from `api/` (the functions are
 * bundled separately), so the union is restated here the same way
 * `features/admin/adminApi.ts` restates its route shapes.
 */
export type FundTierTrust = 'not-seeker' | 'client-asserted-dev' | 'sgt-verified' | 'seeker-rejected'

/** Runtime guard for a label that came off the wire. */
const FUND_TIER_TRUSTS: readonly FundTierTrust[] = [
  'not-seeker',
  'client-asserted-dev',
  'sgt-verified',
  'seeker-rejected',
]

function isFundTierTrust(value: unknown): value is FundTierTrust {
  return FUND_TIER_TRUSTS.includes(value as FundTierTrust)
}

export interface FundTierVerdict {
  allowed: boolean
  /** null only when the gate is not configured (dev default open). */
  tier: FundTierId | null
  /** The tier's ceiling in whole USDC. 0 when the gate is not configured. */
  limitUsdc: number
  reason: string
  seeker: boolean
  /**
   * How the `seeker` claim was judged. Absent when the gate is not
   * configured (no server to ask) and when the server sent a label this
   * build does not recognise — only well-formed output is forwarded, so a
   * future or corrupt value never reaches a screen as if it meant something.
   */
  trust?: FundTierTrust
  /** Device identity the SGT check returned; the key anti-Sybil logic uses. */
  mintAddress?: string | null
  /**
   * The server put this wallet on its operator allowlist (tier2). Never sent
   * by the client — it is an entitlement, so it only ever arrives from the
   * server, and is absent when the gate is off rather than defaulting to
   * `false` (which would claim "checked and not an operator").
   */
  operator?: boolean
}

export interface CheckFundTierInput {
  amountUsdc: number
  wallet: string
  seeker?: boolean
}

export interface CheckFundTierOptions {
  /** Injectable endpoint for tests / overrides. */
  endpoint?: string | null
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
  /** Abort the check after this many milliseconds. Default 8s. */
  timeoutMs?: number
}

/** The configured tier endpoint, or null when the gate is off. */
export function getFundTierEndpoint(): string | null {
  const url = process.env.EXPO_PUBLIC_FUND_TIER_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

/** Post the amount to the backend; throws (fail-closed) when configured but unusable. */
export async function checkFundTier(
  input: CheckFundTierInput,
  options: CheckFundTierOptions = {},
): Promise<FundTierVerdict> {
  const endpoint = options.endpoint !== undefined ? options.endpoint : getFundTierEndpoint()
  if (!endpoint) {
    return {
      allowed: true,
      tier: null,
      limitUsdc: 0,
      reason: 'tier-gate-not-configured',
      seeker: input.seeker === true,
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000)
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amountUsdc: input.amountUsdc,
        wallet: input.wallet,
        seeker: input.seeker === true,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`tier gate responded with ${response.status}`)
    }
    const body = (await response.json()) as Partial<FundTierVerdict>
    if (typeof body.allowed !== 'boolean') {
      throw new Error('tier gate returned a malformed verdict')
    }
    // Everything past `allowed` is forwarded only when it is well-formed:
    // these labels end up on screen, so an unrecognised one is dropped
    // rather than coerced into something plausible.
    const trust = isFundTierTrust(body.trust) ? body.trust : undefined
    const mintAddress = typeof body.mintAddress === 'string' ? body.mintAddress : undefined
    const operator = typeof body.operator === 'boolean' ? body.operator : undefined
    return {
      allowed: body.allowed,
      tier: body.tier ?? null,
      limitUsdc: typeof body.limitUsdc === 'number' ? body.limitUsdc : 0,
      reason: typeof body.reason === 'string' ? body.reason : 'unknown',
      seeker: body.seeker === true,
      ...(trust ? { trust } : {}),
      ...(mintAddress !== undefined ? { mintAddress } : {}),
      ...(operator !== undefined ? { operator } : {}),
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('tier gate')) throw error
    // Network failure / abort against a configured gate: fail closed —
    // no instruction gets built on a guess.
    throw new Error(
      error instanceof Error && error.name === 'AbortError' ? 'tier gate timed out' : 'tier gate unreachable',
    )
  } finally {
    clearTimeout(timer)
  }
}
