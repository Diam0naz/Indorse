/**
 * lib/api-origin.test.ts — candidate parsing + the liveness race
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOriginCandidates, getApiOrigin, invalidateApiOrigin, refreshApiOrigin } from './api-origin'

const CLASSIFY = 'http://localhost:3000/api/classify-gemini'

describe('api-origin', () => {
  beforeEach(() => {
    invalidateApiOrigin()
    vi.stubEnv('EXPO_PUBLIC_AI_CLASSIFY_URL', CLASSIFY)
    vi.stubEnv('EXPO_PUBLIC_API_FALLBACKS', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    invalidateApiOrigin()
  })

  it('returns the configured origin while nothing is pinned', () => {
    expect(getApiOrigin()).toBe('http://localhost:3000')
  })

  it('stays disabled with no configured API URL', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_CLASSIFY_URL', '')
    expect(getApiOrigin()).toBeNull()
    expect(apiOriginCandidates()).toEqual([])
    await expect(refreshApiOrigin()).resolves.toBeNull()
  })

  it('appends normalized, deduped fallbacks in declaration order', () => {
    // `new URL` lowercases the host — candidates come back canonical.
    vi.stubEnv('EXPO_PUBLIC_API_FALLBACKS', ' http://LAN-2:3000/api/x , garbage, http://localhost:3000 ,')
    expect(apiOriginCandidates()).toEqual(['http://localhost:3000', 'http://lan-2:3000'])
  })

  it('pins the first candidate that answers, even when it settles later', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_FALLBACKS', 'http://slow.test:3000')
    const calls: string[] = []
    const fetchImpl = (async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith('http://localhost:3000')) throw new Error('tunnel down')
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true, status: 200 } as Response
    }) as unknown as typeof fetch

    await expect(refreshApiOrigin({ fetchImpl })).resolves.toBe('http://slow.test:3000')
    expect(getApiOrigin()).toBe('http://slow.test:3000')
    expect(calls).toHaveLength(2)
  })

  it('clears the pin and answers null when every candidate fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('all down')
    }) as unknown as typeof fetch

    await expect(refreshApiOrigin({ fetchImpl })).resolves.toBeNull()
    expect(getApiOrigin()).toBe('http://localhost:3000')
  })

  it('treats a non-2xx probe answer as dead', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_FALLBACKS', 'http://busy.test:3000')
    const fetchImpl = (async () => ({ ok: false, status: 503 }) as Response) as unknown as typeof fetch
    await expect(refreshApiOrigin({ fetchImpl })).resolves.toBeNull()
  })

  it('shares one in-flight race across concurrent callers', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_FALLBACKS', 'http://alt.test:3000')
    let probes = 0
    const fetchImpl = (async () => {
      probes += 1
      return { ok: true, status: 200 } as Response
    }) as unknown as typeof fetch

    const [a, b] = await Promise.all([refreshApiOrigin({ fetchImpl }), refreshApiOrigin({ fetchImpl })])
    expect(a).toBe(b)
    expect(probes).toBe(2) // one probe per candidate — not per caller
  })
})
