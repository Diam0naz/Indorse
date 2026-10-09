/**
 * api/_lib/balance.test.ts — ordered provider failover
 */

import { describe, expect, it, vi } from 'vitest'
import { ClassificationError } from './ai-types'
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

describe('balanceProviders — shared deadline', () => {
  it('stays unbounded when no shared budget is given (callers that self-time-out)', async () => {
    let budget = 0
    await balanceProviders([
      {
        name: 'primary',
        run: (timeoutMs) => {
          budget = timeoutMs
          return Promise.resolve('ok')
        },
      },
    ])
    expect(budget).toBe(Number.POSITIVE_INFINITY)
  })

  it('gives every attempt the shared budget when it declares no cap', async () => {
    const seen: number[] = []
    const run =
      (value: string) =>
      (timeoutMs: number): Promise<string> => {
        seen.push(timeoutMs)
        return Promise.resolve(value)
      }

    await balanceProviders([{ name: 'a', run: run('a') }], { totalMs: 42_000 })
    expect(seen[0]).toBeGreaterThan(41_000)
  })

  it('honours a per-attempt cap regardless of the shared budget', async () => {
    const seen: number[] = []
    const result = await balanceProviders<string>(
      [
        {
          name: 'primary',
          budgetMs: 5_000,
          run: (timeoutMs) => {
            seen.push(timeoutMs)
            return Promise.reject(new Error('down'))
          },
        },
        {
          name: 'secondary',
          run: (timeoutMs) => {
            seen.push(timeoutMs)
            return Promise.resolve('ok')
          },
        },
      ],
      { totalMs: 60_000 },
    )

    expect(seen[0]).toBe(5_000)
    expect(result.value).toBe('ok')
  })

  it('hands a fast primary failure’s unused time to the fallback', async () => {
    let fallbackBudget = 0
    const result = await balanceProviders<string>(
      [
        { name: 'primary', budgetMs: 20_000, run: () => Promise.reject(new Error('down')) },
        {
          name: 'secondary',
          run: (timeoutMs) => {
            fallbackBudget = timeoutMs
            return Promise.resolve('ok')
          },
        },
      ],
      { totalMs: 42_000 },
    )

    expect(result.value).toBe('ok')
    // The primary failed instantly, so the fallback gets nearly the whole
    // 42 s — not a second fixed 20 s window.
    expect(fallbackBudget).toBeGreaterThan(41_000)
  })

  it('shrinks the fallback budget by the time the primary spent', async () => {
    vi.useFakeTimers()
    try {
      let fallbackBudget = 0
      const pending = balanceProviders<string>(
        [
          {
            name: 'primary',
            run: async () => {
              await vi.advanceTimersByTimeAsync(10_000)
              throw new Error('down')
            },
          },
          {
            name: 'secondary',
            run: (timeoutMs) => {
              fallbackBudget = timeoutMs
              return Promise.resolve('ok')
            },
          },
        ],
        { totalMs: 42_000 },
      )

      await expect(pending).resolves.toMatchObject({ value: 'ok' })
      expect(fallbackBudget).toBeLessThanOrEqual(32_000)
      expect(fallbackBudget).toBeGreaterThan(31_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not dial another provider once too little budget remains', async () => {
    vi.useFakeTimers()
    try {
      const secondary = vi.fn(() => Promise.resolve('never'))
      const primary = new ClassificationError('timeout', 'primary timed out')
      const pending = balanceProviders(
        [
          {
            name: 'primary',
            run: async () => {
              await vi.advanceTimersByTimeAsync(41_500)
              throw primary
            },
          },
          { name: 'secondary', run: secondary },
        ],
        { totalMs: 42_000 },
      )

      const result = await pending
      // ~500 ms left is not enough for a real round trip; starting one would
      // race the caller's own deadline and misreport the cause.
      expect(secondary).not.toHaveBeenCalled()
      expect(result.value).toBeNull()
      expect(result.firstError).toBe(primary)
    } finally {
      vi.useRealTimers()
    }
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
