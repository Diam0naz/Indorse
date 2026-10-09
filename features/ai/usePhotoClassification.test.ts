import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react-native'
import { usePhotoClassification, CLASSIFY_TIMEOUT_MS, WATCHDOG_GRACE_MS } from '@/features/ai/usePhotoClassification'
import { classifyPhoto, getClassifyEndpoint } from '@/features/ai/classify'
import { ClassificationError, type ClassificationResult } from '@/features/ai/types'

vi.mock('./classify', () => ({
  classifyPhoto: vi.fn(),
  getClassifyEndpoint: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getClassifyEndpoint).mockReturnValue('https://example.com/api/classify')
})

describe('usePhotoClassification', () => {
  it('stays idle when no proxy endpoint is configured', async () => {
    vi.mocked(getClassifyEndpoint).mockReturnValue(null)
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await expect(result.current.classify(['ZmFrZQ=='])).resolves.toBeNull()
    })

    expect(result.current.classifying).toBe(false)
    expect(result.current.classification).toBeNull()
    expect(classifyPhoto).not.toHaveBeenCalled()
  })

  it('ignores empty capture bytes without calling the proxy', async () => {
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await expect(result.current.classify(['   '])).resolves.toBeNull()
    })

    expect(result.current.classifying).toBe(false)
    expect(classifyPhoto).not.toHaveBeenCalled()
  })

  it('lands the classification and clears the pending flag', async () => {
    const pending = deferred<ClassificationResult>()
    vi.mocked(classifyPhoto).mockReturnValue(pending.promise)
    const { result } = await renderHook(() => usePhotoClassification())

    let started!: Promise<ClassificationResult | null>
    await act(async () => {
      started = result.current.classify(['ZmFrZQ=='])
    })
    expect(result.current.classifying).toBe(true)
    expect(result.current.classification).toBeNull()

    pending.resolve({
      label: 'Late Blight',
      confidence: 0.91,
      severity: 'high',
      notes: 'Early blight on lower leaves.',
    })
    await act(async () => {
      await started
    })

    expect(result.current.classification).toEqual({
      label: 'Late Blight',
      confidence: 0.91,
      severity: 'high',
      notes: 'Early blight on lower leaves.',
    })
    expect(result.current.classifying).toBe(false)
  })

  it('collapses failures to null so the caller can fall back', async () => {
    vi.mocked(classifyPhoto).mockRejectedValue(new Error('network down'))
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await expect(result.current.classify(['ZmFrZQ=='])).resolves.toBeNull()
    })

    expect(result.current.classification).toBeNull()
    expect(result.current.classifying).toBe(false)
  })

  it('reset() orphans an in-flight result', async () => {
    const pending = deferred<ClassificationResult>()
    vi.mocked(classifyPhoto).mockReturnValue(pending.promise)
    const { result } = await renderHook(() => usePhotoClassification())

    let started!: Promise<ClassificationResult | null>
    await act(async () => {
      started = result.current.classify(['ZmFrZQ=='])
    })

    await act(async () => {
      result.current.reset()
    })
    expect(result.current.classifying).toBe(false)

    pending.resolve({ label: 'Stale Label', confidence: 1, severity: 'low', notes: 'Stale.' })
    await act(async () => {
      await started
    })

    expect(result.current.classification).toBeNull()
    expect(result.current.classifying).toBe(false)
  })

  it('keeps the cause of a failure so the caller can explain it', async () => {
    vi.mocked(classifyPhoto).mockRejectedValue(new ClassificationError('payload-too-large', 'too big', 413))
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await result.current.classify(['ZmFrZQ=='])
    })

    expect(result.current.error?.code).toBe('payload-too-large')
    expect(result.current.classification).toBeNull()
  })

  it('refuses an upload the proxy would reject instead of sending it', async () => {
    // One shot alone over the 3.5 MB body budget: sending it would come back
    // as a bare host 413 after the whole upload, so it is stopped locally.
    const huge = 'a'.repeat(4_000_000)
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await expect(result.current.classify([huge])).resolves.toBeNull()
    })

    expect(result.current.error?.code).toBe('payload-too-large')
    expect(classifyPhoto).not.toHaveBeenCalled()
  })

  it('settles even when the transport never does (stalled upload)', async () => {
    vi.useFakeTimers()
    try {
      // A request whose abort is never honoured: the promise stays pending.
      vi.mocked(classifyPhoto).mockReturnValue(new Promise<ClassificationResult>(() => {}))
      const { result } = await renderHook(() => usePhotoClassification())

      let started!: Promise<ClassificationResult | null>
      await act(async () => {
        started = result.current.classify(['ZmFrZQ=='])
      })
      expect(result.current.classifying).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLASSIFY_TIMEOUT_MS + WATCHDOG_GRACE_MS)
        await started
      })

      // The spinner cannot outlive the watchdog: state settles as "no verdict".
      expect(result.current.classifying).toBe(false)
      expect(result.current.classification).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends every shot to the proxy in a single classifyPhoto call', async () => {
    vi.mocked(classifyPhoto).mockResolvedValue({ label: 'Leaf Rust', confidence: 0.7, severity: 'low', notes: 'x' })
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await result.current.classify(['ZmFrZQ==', 'b3RoZXI='])
    })

    expect(classifyPhoto).toHaveBeenCalledTimes(1)
    expect(vi.mocked(classifyPhoto)).toHaveBeenCalledWith(
      { images: [{ imageBase64: 'ZmFrZQ==' }, { imageBase64: 'b3RoZXI=' }] },
      expect.objectContaining({ endpoint: 'https://example.com/api/classify' }),
    )
  })
})
