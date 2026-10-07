import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkFundTier, getFundTierEndpoint } from './funds-tier'

/** A fetch double returning a JSON verdict of the given status. */
function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('checkFundTier', () => {
  it('dev default: no endpoint configured → open with an honest reason', async () => {
    vi.stubEnv('EXPO_PUBLIC_FUND_TIER_URL', '')
    expect(getFundTierEndpoint()).toBeNull()
    const verdict = await checkFundTier({ amountUsdc: 5000, wallet: 'any' })
    expect(verdict).toMatchObject({ allowed: true, tier: null, reason: 'tier-gate-not-configured' })
  })

  it('passes the amount through and honours a denial verdict', async () => {
    const fetchImpl = fakeFetch(200, {
      allowed: false,
      tier: 'tier1',
      limitUsdc: 100,
      reason: 'amount-exceeds-tier-limit',
      seeker: false,
    })
    const verdict = await checkFundTier(
      { amountUsdc: 300, wallet: 'Fy2a' },
      { endpoint: 'http://x/funds-tier', fetchImpl },
    )
    expect(fetchImpl).toHaveBeenCalledWith('http://x/funds-tier', expect.objectContaining({ method: 'POST' }))
    expect(verdict.allowed).toBe(false)
    expect(verdict.limitUsdc).toBe(100)
  })

  it('fails closed on a server error (nothing gets built)', async () => {
    const fetchImpl = fakeFetch(503, { error: 'down' })
    await expect(checkFundTier({ amountUsdc: 50, wallet: 'w' }, { endpoint: 'http://x', fetchImpl })).rejects.toThrow(
      'tier gate responded with 503',
    )
  })

  it('fails closed on an unreachable gate', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network request failed')
    }) as unknown as typeof fetch
    await expect(checkFundTier({ amountUsdc: 50, wallet: 'w' }, { endpoint: 'http://x', fetchImpl })).rejects.toThrow(
      'tier gate unreachable',
    )
  })

  it('fails closed on a malformed verdict', async () => {
    const fetchImpl = fakeFetch(200, { hello: 'world' })
    await expect(checkFundTier({ amountUsdc: 50, wallet: 'w' }, { endpoint: 'http://x', fetchImpl })).rejects.toThrow(
      'malformed verdict',
    )
  })

  it('reports the seeker claim through to the verdict', async () => {
    const fetchImpl = fakeFetch(200, {
      allowed: true,
      tier: 'tier3',
      limitUsdc: 500,
      reason: 'within-tier',
      seeker: true,
    })
    const verdict = await checkFundTier(
      { amountUsdc: 400, wallet: 'w', seeker: true },
      { endpoint: 'http://x', fetchImpl },
    )
    expect(verdict.seeker).toBe(true)
  })
})

describe('checkFundTier — the server verdict is kept, not discarded', () => {
  it('forwards trust, mintAddress and operator', async () => {
    const fetchImpl = fakeFetch(200, {
      allowed: true,
      tier: 'tier3',
      limitUsdc: 500,
      reason: 'within-tier',
      seeker: true,
      trust: 'sgt-verified',
      mintAddress: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te',
      operator: true,
    })

    const verdict = await checkFundTier(
      { amountUsdc: 400, wallet: 'w', seeker: true },
      { endpoint: 'http://x', fetchImpl },
    )

    expect(verdict).toMatchObject({
      trust: 'sgt-verified',
      mintAddress: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te',
      operator: true,
    })
  })

  it('keeps a rejection label so the caller can explain the downgrade', async () => {
    const fetchImpl = fakeFetch(200, {
      allowed: false,
      tier: 'tier1',
      limitUsdc: 100,
      reason: 'amount-exceeds-tier-limit',
      seeker: false,
      trust: 'seeker-rejected',
      operator: false,
    })

    const verdict = await checkFundTier(
      { amountUsdc: 400, wallet: 'w', seeker: true },
      { endpoint: 'http://x', fetchImpl },
    )

    expect(verdict.trust).toBe('seeker-rejected')
  })

  it('drops labels this build does not recognise rather than forwarding garbage', async () => {
    const fetchImpl = fakeFetch(200, {
      allowed: true,
      tier: 'tier2',
      limitUsdc: 250,
      reason: 'within-tier',
      seeker: false,
      trust: 'definitely-a-trust-value',
      operator: 'yes-please',
      mintAddress: 42,
    })

    const verdict = await checkFundTier({ amountUsdc: 200, wallet: 'w' }, { endpoint: 'http://x', fetchImpl })

    // Absent, not coerced — a made-up label must never reach a screen.
    expect(verdict.trust).toBeUndefined()
    expect(verdict.operator).toBeUndefined()
    expect(verdict.mintAddress).toBeUndefined()
  })

  it('claims nothing about operator status when no server was asked', async () => {
    vi.stubEnv('EXPO_PUBLIC_FUND_TIER_URL', '')
    const verdict = await checkFundTier({ amountUsdc: 200, wallet: 'w' })

    // Not `false` — that would mean "checked, not an operator".
    expect(verdict.operator).toBeUndefined()
    expect(verdict.trust).toBeUndefined()
  })
})
