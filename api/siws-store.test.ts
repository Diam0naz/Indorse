import { describe, expect, it, vi } from 'vitest'
import {
  createSiwsStore,
  RedisSiwsStore,
  SIWS_TTL_MS,
  type IssuedSiwsPayload,
  type SiwsFetch,
} from '@/api/_lib/siws-store'

const payload: IssuedSiwsPayload = {
  chainId: 'solana:mainnet',
  domain: 'indorse.app',
  expirationTime: '2099-01-01T00:00:00.000Z',
  issuedAt: '2026-01-01T00:00:00.000Z',
  nonce: 'abc123',
  statement: 'Sign in to verify this device',
  uri: 'https://indorse.app',
  version: '1',
}

/** A fetch-shaped stub for a single command response. */
function stubFetch(handler: (command: unknown[]) => unknown): { fetchImpl: SiwsFetch; commands: unknown[][] } {
  const commands: unknown[][] = []
  const fetchImpl: SiwsFetch = async (_url, init) => {
    const command = JSON.parse(String(init?.body)) as unknown[]
    commands.push(command)
    const result = handler(command)
    return { ok: true, status: 200, json: async () => result } as unknown as Response
  }
  return { fetchImpl, commands }
}

describe('createSiwsStore', () => {
  it('defaults to the in-memory store when Redis env is absent', async () => {
    const store = createSiwsStore({})
    await store.issue(payload)

    expect(await store.consume(payload.nonce)).toEqual(payload)
    // Single-use: the second read finds nothing.
    expect(await store.consume(payload.nonce)).toBeNull()
  })

  it('uses the Redis store only when BOTH REST env keys are set', () => {
    const base = { UPSTASH_REDIS_REST_URL: 'https://redis.test' }
    const both = { ...base, UPSTASH_REDIS_REST_TOKEN: 'tok' }

    expect(createSiwsStore(base)).not.toBeInstanceOf(RedisSiwsStore) // token missing
    expect(createSiwsStore(both)).toBeInstanceOf(RedisSiwsStore)
  })
})

describe('RedisSiwsStore', () => {
  it('stores with a PX TTL, then reads and burns with GETDEL', async () => {
    const { fetchImpl, commands } = stubFetch((command) =>
      command[0] === 'GETDEL' ? { result: JSON.stringify(payload) } : { result: 'OK' },
    )
    const store = new RedisSiwsStore('https://redis.test', 'tok', 1_234, fetchImpl)

    await store.issue(payload)
    await expect(store.consume(payload.nonce)).resolves.toEqual(payload)

    expect(commands[0]).toEqual(['SET', `siws:nonce:${payload.nonce}`, JSON.stringify(payload), 'PX', 1_234])
    expect(commands[1]).toEqual(['GETDEL', `siws:nonce:${payload.nonce}`])
  })

  it('uses the default TTL when none is given', async () => {
    const { fetchImpl, commands } = stubFetch(() => ({ result: 'OK' }))
    await new RedisSiwsStore('https://redis.test', 'tok', undefined, fetchImpl).issue(payload)

    expect(commands[0]).toContain(SIWS_TTL_MS)
  })

  it('treats a null GETDEL result as "no nonce" (expired, unknown or replayed)', async () => {
    const { fetchImpl } = stubFetch(() => ({ result: null }))
    const store = new RedisSiwsStore('https://redis.test', 'tok', undefined, fetchImpl)

    await expect(store.consume('missing')).resolves.toBeNull()
  })

  it('treats unreadable residue as absent rather than a valid proof', async () => {
    const { fetchImpl } = stubFetch(() => ({ result: 'not json' }))
    const store = new RedisSiwsStore('https://redis.test', 'tok', undefined, fetchImpl)

    await expect(store.consume(payload.nonce)).resolves.toBeNull()
  })

  it('authenticates with the bearer token', async () => {
    const seen: RequestInit[] = []
    const fetchImpl: SiwsFetch = async (_url, init) => {
      seen.push(init ?? {})
      return { ok: true, status: 200, json: async () => ({ result: 'OK' }) } as unknown as Response
    }

    await new RedisSiwsStore('https://redis.test', 'secret-token', undefined, fetchImpl).issue(payload)

    expect(seen[0].headers).toMatchObject({ authorization: 'Bearer secret-token' })
  })

  it('throws on an HTTP failure — an outage must not read as "no nonce"', async () => {
    const down: SiwsFetch = async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response
    const store = new RedisSiwsStore('https://redis.test', 'tok', undefined, down)

    await expect(store.consume(payload.nonce)).rejects.toThrow(/503/)
  })

  it('throws on a command-level error', async () => {
    const { fetchImpl } = stubFetch(() => ({ error: 'WRONGPASS invalid password' }))
    const store = new RedisSiwsStore('https://redis.test', 'tok', undefined, fetchImpl)

    await expect(store.issue(payload)).rejects.toThrow(/WRONGPASS/)
  })

  it('propagates a network rejection', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as SiwsFetch
    const store = new RedisSiwsStore('https://redis.test', 'tok', undefined, fetchImpl)

    await expect(store.consume(payload.nonce)).rejects.toThrow('offline')
  })
})
