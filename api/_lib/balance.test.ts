/**
 * api/_lib/balance.test.ts — ordered provider failover
 */

import { describe, expect, it, vi } from 'vitest'
import { ClassificationError } from '@/features/ai/types'
import { balanceProviders, isClientFault } from './balance'

describe('balanceProviders', () => {
  it('answers from the primary when it is healthy and never touches the rest', async () => {
    const second = vi.fn(() => Promise.resolve('second'))
    const result = await balanceProviders([
      { name: 'primary', run: () => Promise.resolve('first') },
      { name: 'secondary', run: second },
    ])
    expect(result).toEqual({ value: 'first', via: 'primary', firstError: null })
    expect(second).not.toHaveBeenCalled()
  })

  it('falls to the next provider on a provider-side failure', async () => {
    const outage = new ClassificationError('upstream', 'Groq responded with 503', 503)
    const result = await balanceProviders<string>([
      { name: 'groq', run: () => Promise.reject(outage) },
      { name: 'openai', run: () => Promise.resolve('fallback reply') },
    ])
    expect(result).toEqual({ value: 'fallback reply', via: 'openai', firstError: null })
  })

  it('tries the next provider after a raw (unwrapped) throw', async () => {
    const result = await balanceProviders([
      { name: 'a', run: () => Promise.reject(new Error('socket hang up')) },
      { name: 'b', run: () => Promise.resolve(42) },
    ])
    expect(result.value).toBe(42)
    expect(result.via).toBe('b')
  })

  it('fails fast on a client fault — every provider would reject the payload', async () => {
    const second = vi.fn(() => Promise.resolve('never'))
    const fault = new ClassificationError('bad-request', 'images[] requires at least one imageBase64 entry')
    const result = await balanceProviders<string>([
      { name: 'primary', run: () => Promise.reject(fault) },
      { name: 'secondary', run: second },
    ])
    expect(result.value).toBeNull()
    expect(result.firstError).toBe(fault)
    expect(second).not.toHaveBeenCalled()
  })

  it('a total outage reports the PRIMARY error, preserving its contract', async () => {
    const primary = new ClassificationError('upstream', 'Groq responded with 429', 429)
    const secondary = new ClassificationError('upstream', 'OpenAI responded with 502', 502)
    const result = await balanceProviders<string>([
      { name: 'groq', run: () => Promise.reject(primary) },
      { name: 'openai', run: () => Promise.reject(secondary) },
    ])
    expect(result.value).toBeNull()
    expect(result.via).toBeNull()
    expect(result.firstError).toBe(primary)
  })
})

describe('isClientFault', () => {
  it('marks only bad-request as the client’s fault', () => {
    expect(isClientFault(new ClassificationError('bad-request', 'x'))).toBe(true)
    for (const code of ['upstream', 'network', 'timeout', 'malformed', 'unauthorized'] as const) {
      expect(isClientFault(new ClassificationError(code, 'x'))).toBe(false)
    }
    expect(isClientFault(new Error('raw'))).toBe(false)
  })
})
