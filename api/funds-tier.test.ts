import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { FUND_TIERS, createFundsTierHandler, tierForSeeker } from '@/api/funds-tier'
import type { SgtChecker } from '@/api/_lib/sgt'

function mockRes() {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.payload = body
    },
  }
  return res
}

async function post(body: unknown) {
  const res = mockRes()
  await handler({ method: 'POST', body }, res)
  return res
}

describe('POST /api/funds-tier', () => {
  it('answers 405 to non-POST methods', async () => {
    const res = mockRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a missing or non-positive amount', async () => {
    for (const body of [
      {},
      { amountUsdc: 0, wallet: 'w' },
      { amountUsdc: -5, wallet: 'w' },
      { amountUsdc: '100', wallet: 'w' },
    ]) {
      const res = await post(body)
      expect(res.statusCode).toBe(400)
    }
  })

  it('rejects a missing wallet', async () => {
    const res = await post({ amountUsdc: 50, wallet: '  ' })
    expect(res.statusCode).toBe(400)
  })

  it('base tier caps cover at $100', async () => {
    const ok = await post({ amountUsdc: 100, wallet: 'Fy2a' })
    expect(ok.statusCode).toBe(200)
    expect(ok.payload).toMatchObject({ allowed: true, tier: 'tier1', limitUsdc: 100, seeker: false })

    const over = await post({ amountUsdc: 100.01, wallet: 'Fy2a' })
    expect(over.statusCode).toBe(200)
    expect(over.payload).toMatchObject({ allowed: false, reason: 'amount-exceeds-tier-limit' })
  })

  it('Seeker devices climb to the $500 tier', async () => {
    const res = await post({ amountUsdc: 500, wallet: 'Fy2a', seeker: true })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ allowed: true, tier: 'tier3', limitUsdc: 500, seeker: true })
    // Honest provenance: the claim is client-asserted in the POC.
    expect(res.payload).toMatchObject({ trust: 'client-asserted-dev' })
  })

  it('non-seeker amount above $100 is denied even below $500', async () => {
    const res = await post({ amountUsdc: 300, wallet: 'Fy2a' })
    expect(res.payload).toMatchObject({ allowed: false, tier: 'tier1', limitUsdc: 100 })
  })

  it('the ladder itself is $100 / $250 / $500 with tier2 reserved', () => {
    expect(FUND_TIERS.map((tier) => tier.limitUsdc)).toEqual([100, 250, 500])
    expect(tierForSeeker(false).id).toBe('tier1')
    expect(tierForSeeker(true).id).toBe('tier3')
  })
})

describe('POST /api/funds-tier — server-side SGT verification (SGT_RPC_URL configured)', () => {
  /** A parseable mainnet-format address — the legacy tests' 'Fy2a' is not one. */
  const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  const SGT_MINT = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'

  beforeEach(() => {
    process.env.SGT_RPC_URL = 'https://mainnet.example.invalid'
  })

  afterEach(() => {
    delete process.env.SGT_RPC_URL
  })

  async function postWith(checkSgt: SgtChecker, body: unknown) {
    const res = mockRes()
    await createFundsTierHandler({ checkSgt })({ method: 'POST', body }, res)
    return res
  }

  it('grants tier3 only to a wallet that passes the SGT check', async () => {
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: true, mintAddress: SGT_MINT }))

    const res = await postWith(checkSgt, { amountUsdc: 500, wallet: WALLET, seeker: true })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({
      allowed: true,
      tier: 'tier3',
      limitUsdc: 500,
      seeker: true,
      trust: 'sgt-verified',
      mintAddress: SGT_MINT,
    })
    expect(checkSgt).toHaveBeenCalledWith(WALLET)
  })

  it('downgrades a claimed Seeker that fails the check to the base tier', async () => {
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: false, mintAddress: null }))

    const res = await postWith(checkSgt, { amountUsdc: 500, wallet: WALLET, seeker: true })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({
      allowed: false,
      tier: 'tier1',
      limitUsdc: 100,
      seeker: false,
      trust: 'seeker-rejected',
      reason: 'amount-exceeds-tier-limit',
    })
    expect(res.payload).not.toHaveProperty('mintAddress')
  })

  it('answers 503 when the check fails — an outage grants nothing and denies nothing', async () => {
    const checkSgt = vi.fn<SgtChecker>(async () => {
      throw new Error('rpc down')
    })

    const res = await postWith(checkSgt, { amountUsdc: 500, wallet: WALLET, seeker: true })

    expect(res.statusCode).toBe(503)
    expect(res.payload).toEqual({ error: 'Seeker verification temporarily unavailable' })
  })

  it('rejects an unparseable wallet before the claim reaches the RPC', async () => {
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: true, mintAddress: SGT_MINT }))

    const res = await postWith(checkSgt, { amountUsdc: 500, wallet: 'Fy2a', seeker: true })

    expect(res.statusCode).toBe(400)
    expect(checkSgt).not.toHaveBeenCalled()
  })

  it('does not consult the check without a seeker claim', async () => {
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: true, mintAddress: SGT_MINT }))

    const res = await postWith(checkSgt, { amountUsdc: 500, wallet: WALLET })

    expect(res.payload).toMatchObject({ tier: 'tier1', seeker: false, trust: 'not-seeker' })
    expect(checkSgt).not.toHaveBeenCalled()
  })

  it('keeps the client-asserted label when the check is not configured', async () => {
    delete process.env.SGT_RPC_URL
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: false, mintAddress: null }))

    const res = await postWith(checkSgt, { amountUsdc: 500, wallet: 'Fy2a', seeker: true })

    expect(res.payload).toMatchObject({ allowed: true, tier: 'tier3', seeker: true, trust: 'client-asserted-dev' })
    expect(checkSgt).not.toHaveBeenCalled()
  })
})
