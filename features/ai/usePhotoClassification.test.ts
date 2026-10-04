import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react-native'
import { usePhotoClassification } from '@/features/ai/usePhotoClassification'
import { classifyPhoto, getClassifyEndpoint } from '@/features/ai/classify'
import type { ClassificationResult } from '@/features/ai/types'

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
      await expect(result.current.classify('ZmFrZQ==')).resolves.toBeNull()
    })

    expect(result.current.classifying).toBe(false)
    expect(result.current.classification).toBeNull()
    expect(classifyPhoto).not.toHaveBeenCalled()
  })

  it('ignores empty capture bytes without calling the proxy', async () => {
    const { result } = await renderHook(() => usePhotoClassification())

    await act(async () => {
      await expect(result.current.classify('   ')).resolves.toBeNull()
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
      started = result.current.classify('ZmFrZQ==')
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
      await expect(result.current.classify('ZmFrZQ==')).resolves.toBeNull()
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
      started = result.current.classify('ZmFrZQ==')
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
})
