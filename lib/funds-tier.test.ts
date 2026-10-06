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
