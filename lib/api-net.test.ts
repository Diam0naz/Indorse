/**
 * lib/api-net.test.ts — the wrapped global fetch (origin swap + one retry)
 *
 * `createResilientFetch` is tested through injected seams, so those cases
 * never touch global fetch state. `installResilientFetch` is the exception:
 * it exists to mutate `globalThis`, so it is exercised against a saved and
 * restored global (see that describe block).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResilientFetch, installResilientFetch, type FetchInput, type FetchLike } from './api-net'
import { getApiOrigin, invalidateApiOrigin } from './api-origin'

const LOCALHOST = 'http://localhost:3000'
const LAN = 'http://192.168.100.156:3000'

const ok = (): Promise<Response> => Promise.resolve({ ok: true, status: 200 } as Response)

function wrap(
  base: FetchLike,
  overrides: { candidates?: string[]; active?: string | null; refresh?: () => Promise<string | null> } = {},
): FetchLike {
  return createResilientFetch(base, {
    candidates: () => overrides.candidates ?? [LOCALHOST, LAN],
    active: () => (overrides.active === undefined ? null : overrides.active),
    refresh: overrides.refresh ?? (() => Promise.resolve(null)),
  })
}

describe('createResilientFetch', () => {
  it('passes foreign origins straight through (RPC and friends are not ours)', async () => {
    const base = vi.fn(() => ok()) as unknown as FetchLike & ReturnType<typeof vi.fn>
    const wrapped = wrap(base)
    await wrapped('https://api.devnet.solana.com/', { method: 'POST' })
    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe('https://api.devnet.solana.com/')
  })

  it('rewrites to the pinned active origin before the first attempt', async () => {
    const base = vi.fn(() => ok()) as unknown as FetchLike & ReturnType<typeof vi.fn>
    const wrapped = wrap(base, { active: LAN })
    await wrapped(`${LOCALHOST}/api/directory`)
    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe(`${LAN}/api/directory`)
  })

  it('re-races on a network rejection and retries once on the winner', async () => {
    const base = vi.fn((input: Parameters<FetchLike>[0]) => {
      if (String(input).startsWith(LOCALHOST)) return Promise.reject(new Error('ECONNREFUSED'))
      return ok()
    }) as unknown as FetchLike & ReturnType<typeof vi.fn>
    const refresh = vi.fn(() => Promise.resolve(LAN))
    const wrapped = wrap(base, { refresh })

    const response = await wrapped(`${LOCALHOST}/api/email/start`, { method: 'POST' })
    expect(response.ok).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(base).toHaveBeenCalledTimes(2)
    expect(base.mock.calls[1][0]).toBe(`${LAN}/api/email/start`)
    expect(base.mock.calls[1][1]).toEqual({ method: 'POST' })
  })

  it('retries the same origin once when the race confirms it alive', async () => {
    let attempts = 0
    const base = vi.fn(() => {
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error('flap')) : ok()
    }) as unknown as FetchLike & ReturnType<typeof vi.fn>
    const wrapped = wrap(base, { refresh: () => Promise.resolve(LOCALHOST) })

    await expect(wrapped(`${LOCALHOST}/api/directory`)).resolves.toMatchObject({ ok: true })
    expect(base).toHaveBeenCalledTimes(2)
    expect(base.mock.calls[1][0]).toBe(`${LOCALHOST}/api/directory`)
  })

  it('propagates the original error when no candidate answers', async () => {
    const base = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as FetchLike &
      ReturnType<typeof vi.fn>
    const wrapped = wrap(base, { refresh: () => Promise.resolve(null) })

    await expect(wrapped(`${LOCALHOST}/api/directory`)).rejects.toThrow('ECONNREFUSED')
    expect(base).toHaveBeenCalledTimes(1) // one attempt, no hammering
  })

  it('never retries an HTTP error response — a 500 is a reachable server', async () => {
    const base = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)) as unknown as FetchLike &
      ReturnType<typeof vi.fn>
    const refresh = vi.fn(() => Promise.resolve(LAN))
    const wrapped = wrap(base, { refresh })

    const response = await wrapped(`${LOCALHOST}/api/classify`, { method: 'POST' })
    expect(response.status).toBe(500)
    expect(refresh).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('stops after exactly one retry even when the retry also fails', async () => {
    const base = vi.fn(() => Promise.reject(new Error('still down'))) as unknown as FetchLike & ReturnType<typeof vi.fn>
    const wrapped = wrap(base, { refresh: () => Promise.resolve(LAN) })

    await expect(wrapped(`${LOCALHOST}/api/directory`)).rejects.toThrow('still down')
    expect(base).toHaveBeenCalledTimes(2)
  })
})

describe('installResilientFetch', () => {
  interface MutatedGlobal {
    fetch?: unknown
    __indorseResilientFetch?: boolean
  }

  const LOCALHOST = 'http://localhost:3000'

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
    delete process.env.EXPO_PUBLIC_API_FALLBACKS
    invalidateApiOrigin()
  })

  /**
   * Run against a global seeded with `fetchValue`, putting back exactly what
   * was there before — `globalThis.fetch` and the idempotency flag both.
   */
  function withCleanGlobal(fetchValue: unknown, run: (target: MutatedGlobal) => void): void {
    const target = globalThis as unknown as MutatedGlobal
    const hadFetch = 'fetch' in target
    const savedFetch = target.fetch
    const savedFlag = target.__indorseResilientFetch
    target.fetch = fetchValue
    delete target.__indorseResilientFetch
    try {
      run(target)
    } finally {
      if (hadFetch) target.fetch = savedFetch
      else delete target.fetch
      if (savedFlag === undefined) delete target.__indorseResilientFetch
      else target.__indorseResilientFetch = savedFlag
    }
  }

  it('wraps the global fetch — and a second install is a no-op, not a double wrap', () => {
    const original = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))

    withCleanGlobal(original, (target) => {
      installResilientFetch()

      const wrapped = target.fetch
      expect(typeof wrapped).toBe('function')
      expect(wrapped).not.toBe(original)
      expect((target as { __indorseResilientFetch?: boolean }).__indorseResilientFetch).toBe(true)

      installResilientFetch()
      expect(target.fetch).toBe(wrapped)
    })
  })

  it('leaves a global it cannot wrap exactly as it found it', () => {
    withCleanGlobal(undefined, (target) => {
      installResilientFetch()

      // Nothing installed, no flag claimed: a later install must still work
      // once a real fetch exists.
      expect(target.fetch).toBeUndefined()
      expect(target.__indorseResilientFetch).toBeUndefined()
    })
  })

  it('kicks off the origin race at install, so the first request can start pinned', async () => {
    process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = `${LOCALHOST}/api/classify`
    const probe = vi.fn((_input: FetchInput, _init?: RequestInit) =>
      Promise.resolve({ ok: true, status: 200 } as Response),
    )

    withCleanGlobal(probe, (target) => {
      installResilientFetch()
      // Wrapped…
      expect(target.fetch).not.toBe(probe)
      // …and the warm race already dialled the configured origin: the probe
      // impl is captured synchronously, before the global is handed back.
      expect(probe).toHaveBeenCalledTimes(1)
    })

    expect(String(probe.mock.calls[0][0])).toBe(`${LOCALHOST}/api/directory`)
    // The winner is pinned asynchronously, ahead of any real request.
    await vi.waitFor(() => expect(getApiOrigin()).toBe(LOCALHOST))
  })
})
