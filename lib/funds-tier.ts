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
 *   tier2  $250   reserved — verified operators (next up)
 *   tier3  $500   Seeker devices
 *
 * Configuration:
 *   EXPO_PUBLIC_FUND_TIER_URL  set  → the gate is enforced (fail-closed:
 *                                      an unreachable/malformed answer
 *                                      throws, so no instruction is built)
 *                             unset → dev default is open with
 *                                      reason 'tier-gate-not-configured'
 *
 * `seeker` is client-asserted (EXPO_PUBLIC_FORCE_SEEKER is a dev flag);
 * the server decides how far to trust it and says which gate ran via
 * `trust`: 'sgt-verified' when the shared SGT check passes (mainnet,
 * `SGT_RPC_URL`), 'seeker-rejected' when it fails (downgraded to tier1),
 * or 'client-asserted-dev' when the check is not configured.
 */

export type FundTierId = 'tier1' | 'tier2' | 'tier3'

export interface FundTierVerdict {
  allowed: boolean
  /** null only when the gate is not configured (dev default open). */
  tier: FundTierId | null
  /** The tier's ceiling in whole USDC. 0 when the gate is not configured. */
  limitUsdc: number
  reason: string
  seeker: boolean
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
    return {
      allowed: body.allowed,
      tier: body.tier ?? null,
      limitUsdc: typeof body.limitUsdc === 'number' ? body.limitUsdc : 0,
      reason: typeof body.reason === 'string' ? body.reason : 'unknown',
      seeker: body.seeker === true,
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
