import { describe, it, expect, vi } from 'vitest'
import { classifyPhoto } from '@/features/ai/classify'
import { ClassificationError } from '@/features/ai/types'

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch
}

function errorFetch(status: number): typeof fetch {
  return vi.fn(async () => ({ ok: false, status, json: async () => ({}) })) as unknown as typeof fetch
}

/** A full proxy verdict in the shape `parseClassification` demands. */
function verdict(label: string, confidence: number) {
  return { label, confidence, severity: 'medium', notes: 'Observe and rescout in five days.' } as const
}

describe('classifyPhoto', () => {
  it('POSTs the image to the proxy and returns the parsed result', async () => {
    const fetchImpl = okFetch(verdict('Gray Leaf Spot', 0.82))

    const result = await classifyPhoto(
      { imageBase64: 'ZmFrZQ==', mimeType: 'image/png' },
      { endpoint: 'https://example.com/api/classify', fetchImpl },
    )

    expect(result).toEqual({
      label: 'Gray Leaf Spot',
      confidence: 0.82,
      severity: 'medium',
      notes: 'Observe and rescout in five days.',
    })

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://example.com/api/classify')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as Record<string, unknown>).headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      imageBase64: 'ZmFrZQ==',
      mimeType: 'image/png',
    })
  })

  it('defaults the mime type to image/jpeg', async () => {
    const fetchImpl = okFetch(verdict('Leaf Rust', 0.5))
    await classifyPhoto({ imageBase64: 'ZmFrZQ==' }, { endpoint: 'https://example.com/api/classify', fetchImpl })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string).mimeType).toBe('image/jpeg')
  })

  it('throws bad-request without image bytes', async () => {
    await expect(
      classifyPhoto({ imageBase64: '  ' }, { endpoint: 'https://example.com', fetchImpl: okFetch({}) }),
    ).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('throws bad-request without an endpoint', async () => {
    await expect(classifyPhoto({ imageBase64: 'x' }, { endpoint: '' })).rejects.toBeInstanceOf(ClassificationError)
  })

  it('maps a 401 to unauthorized', async () => {
    await expect(
      classifyPhoto({ imageBase64: 'x' }, { endpoint: 'https://example.com', fetchImpl: errorFetch(401) }),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('maps a 500 to upstream', async () => {
    await expect(
      classifyPhoto({ imageBase64: 'x' }, { endpoint: 'https://example.com', fetchImpl: errorFetch(500) }),
    ).rejects.toMatchObject({ code: 'upstream', status: 500 })
  })

  it('maps a thrown fetch to network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof fetch

    await expect(
      classifyPhoto({ imageBase64: 'x' }, { endpoint: 'https://example.com', fetchImpl }),
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('times out a hanging request', async () => {
    const hanging = ((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }) as unknown as typeof fetch

    await expect(
      classifyPhoto({ imageBase64: 'x' }, { endpoint: 'https://example.com', fetchImpl: hanging, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('surfaces a malformed proxy payload', async () => {
    await expect(
      classifyPhoto({ imageBase64: 'x' }, { endpoint: 'https://example.com', fetchImpl: okFetch({ label: '' }) }),
    ).rejects.toMatchObject({ code: 'malformed' })
  })
})
