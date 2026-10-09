import { describe, expect, it, vi } from 'vitest'
import { settleAfter } from '@/lib/settle'

describe('settleAfter', () => {
  it('resolves the value when the promise settles first', async () => {
    await expect(settleAfter(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })

  it('resolves null when the promise rejects', async () => {
    await expect(settleAfter(Promise.reject(new Error('down')), 1000)).resolves.toBeNull()
  })

  it('resolves null when the transport never settles (stalled request)', async () => {
    vi.useFakeTimers()
    try {
      const stalled = new Promise<string>(() => {})
      let settled: string | null | undefined
      void settleAfter(stalled, 5000).then((value) => {
        settled = value
      })

      await vi.advanceTimersByTimeAsync(4999)
      expect(settled).toBeUndefined()

      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
