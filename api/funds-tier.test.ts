import { describe, expect, it } from 'vitest'
import handler, { FUND_TIERS, tierForSeeker } from '@/api/funds-tier'

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
