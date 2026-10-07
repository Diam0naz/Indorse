/**
 * api/directory.test.ts — publish/verify/list against a fake chain read
 *
 * The chain read is injected, so these cases pin the handler contract:
 * a publish is verified before it is stored, stale snapshots re-read on
 * GET (keeping the old row when the read fails), and the per-IP budget
 * caps how fast one client can fill the directory.
 */

import { describe, expect, it, vi } from 'vitest'
import { createDirectoryHandler, RATE_LIMIT, STALE_MS, type DirectoryFarm } from '@/api/directory'

const FARM_A = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const FARM_B = 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5'

function snapshot(address: string, name = 'Rowan Ridge'): DirectoryFarm {
  return {
    address,
    name,
    lat: 46.8821,
    lng: -98.7023,
    owner: FARM_B,
    reportCount: 3,
    verifiedReportCount: 2,
    batchCount: 1,
    policyCount: 0,
    updatedAt: 0,
  }
}

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

interface Harness {
  handler: ReturnType<typeof createDirectoryHandler>
  readFarm: ReturnType<typeof vi.fn>
  clock: { now: number }
}

/** Fresh handler per test — the store and limiter are per-instance. */
function harness(readImpl?: (address: string) => Promise<DirectoryFarm | null>): Harness {
  const clock = { now: 1_000_000 }
  const readFarm = vi.fn(readImpl ?? (async (address: string) => snapshot(address)))
  const handler = createDirectoryHandler({ readFarm, now: () => clock.now, staleMs: STALE_MS })
  return { handler, readFarm, clock }
}

async function call(h: Harness, req: { method?: string; body?: unknown; ip?: string }) {
  const res = mockRes()
  await h.handler(req, res)
  return res
}

describe('directory publish (POST)', () => {
  it('verifies against the chain before storing, and stamps its snapshot time', async () => {
    const h = harness()
    const res = await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '1.2.3.4' })

    expect(res.statusCode).toBe(200)
    expect(h.readFarm).toHaveBeenCalledWith(FARM_A)
    const body = res.payload as { farm: DirectoryFarm }
    expect(body.farm).toMatchObject({ address: FARM_A, name: 'Rowan Ridge' })
    expect(body.farm.updatedAt).toBe(h.clock.now)

    // The GET answers with exactly what was verified.
    const list = await call(h, { method: 'GET' })
    expect((list.payload as { farms: DirectoryFarm[] }).farms).toHaveLength(1)
  })

  it('rejects an address that is not base58', async () => {
    const h = harness()
    for (const body of [{}, { farm: '' }, { farm: 'not-an-address!!' }]) {
      const res = await call(h, { method: 'POST', body, ip: '1.2.3.4' })
      expect(res.statusCode).toBe(400)
      expect(res.payload).toEqual({ error: 'bad-address' })
    }
    expect(h.readFarm).not.toHaveBeenCalled()
  })

  it('404s an address the chain says is not a farm', async () => {
    const h = harness(async () => null)
    const res = await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '1.2.3.4' })
    expect(res.statusCode).toBe(404)
    expect(res.payload).toEqual({ error: 'not-a-farm' })
  })

  it('502s an RPC outage without pretending the farm was rejected', async () => {
    const h = harness(async () => {
      throw new Error('429 from the cluster')
    })
    const res = await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '1.2.3.4' })
    expect(res.statusCode).toBe(502)
    expect(res.payload).toEqual({ error: 'rpc-unavailable' })
  })

  it('rate-limits one IP at the publish budget and leaves others room', async () => {
    const h = harness()
    for (let i = 0; i < RATE_LIMIT.max; i += 1) {
      const res = await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '9.9.9.9' })
      expect(res.statusCode).toBe(200)
    }
    const over = await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '9.9.9.9' })
    expect(over.statusCode).toBe(429)

    const other = await call(h, { method: 'POST', body: { farm: FARM_B }, ip: '8.8.8.8' })
    expect(other.statusCode).toBe(200)
  })
})

describe('directory read (GET)', () => {
  it('re-reads snapshots past the TTL and serves the fresh counts', async () => {
    const h = harness()
    await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '1.2.3.4' })
    expect(h.readFarm).toHaveBeenCalledTimes(1)

    // Within the TTL the counts are still served as-is — no RPC spent.
    h.clock.now += STALE_MS - 1
    await call(h, { method: 'GET' })
    expect(h.readFarm).toHaveBeenCalledTimes(1)

    // Past it: one refresh, and the answer carries the new snapshot.
    h.clock.now += 2
    const list = await call(h, { method: 'GET' })
    expect(h.readFarm).toHaveBeenCalledTimes(2)
    const farms = (list.payload as { farms: DirectoryFarm[] }).farms
    expect(farms).toHaveLength(1)
    expect(farms[0].updatedAt).toBe(h.clock.now)
  })

  it('keeps serving the stale row when the refresh read fails', async () => {
    let attempts = 0
    const h = harness(async (address) => {
      attempts += 1
      if (attempts > 1) throw new Error('cluster 429')
      return snapshot(address)
    })
    await call(h, { method: 'POST', body: { farm: FARM_A }, ip: '1.2.3.4' })
    h.clock.now += STALE_MS + 1

    const list = await call(h, { method: 'GET' })
    const farms = (list.payload as { farms: DirectoryFarm[] }).farms
    expect(farms).toHaveLength(1)
    expect(farms[0].address).toBe(FARM_A)
    // The snapshot time did not advance — its age stays honest.
    expect(farms[0].updatedAt).toBe(1_000_000)
  })
})
