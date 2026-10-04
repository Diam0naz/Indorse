import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import handler from '@/api/classify-gemini'
import { GEMINI_TIMEOUT_MS } from '@/api/_lib/gemini'

/**
 * Fake `node:http2` so the handler tests run through the real `h2Fetch`
 * transport (event wiring, status line, body assembly) without a network.
 * Responses are scripted per test via `h2.state`.
 */
const h2 = vi.hoisted(() => {
  const state = {
    status: 200,
    body: '{}',
    error: null as Error | null,
    noResponse: false,
    connects: [] as string[],
    requests: [] as Array<{ headers: Record<string, string>; body: string }>,
  }

  const client = {
    on: () => client,
    close: () => {},
    destroy: () => {},
    request(headers: Record<string, string>) {
      const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
      const fire = (event: string, ...args: unknown[]) => {
        for (const callback of handlers[event] ?? []) callback(...args)
      }
      return {
        on(event: string, callback: (...args: unknown[]) => void) {
          ;(handlers[event] ||= []).push(callback)
          return this
        },
        setEncoding: () => {},
        end(body: string) {
          state.requests.push({ headers, body })
          if (state.noResponse) return
          queueMicrotask(() => {
            if (state.error) {
              fire('error', state.error)
              return
            }
            fire('response', { ':status': state.status })
            if (state.body) fire('data', state.body)
            fire('end')
          })
        },
      }
    },
  }

  const connect = (authority: string) => {
    state.connects.push(authority)
    return client
  }

  return { state, connect }
})

vi.mock('node:http2', () => ({ connect: h2.connect }))

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

/** Script a buffered `generateContent` reply — verdict JSON in `candidates`. */
function scriptVerdict(verdict: { label: string; confidence: number; severity: string; notes: string }) {
  h2.state.status = 200
  h2.state.body = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }] })
}

const GRAY_LEAF_SPOT = {
  label: 'Gray Leaf Spot',
  confidence: 0.87,
  severity: 'medium',
  notes: 'Gray lesions on lower leaves.',
}

describe('POST /api/classify-gemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    h2.state.status = 200
    h2.state.body = '{}'
    h2.state.error = null
    h2.state.noResponse = false
    h2.state.connects.length = 0
    h2.state.requests.length = 0
  })

  afterEach(() => {
    delete process.env.GEMINI_API_KEY
    vi.useRealTimers()
  })

  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a missing image', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { mimeType: 'image/jpeg' } }, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects an oversized image before calling the model', async () => {
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'a'.repeat(8 * 1024 * 1024 + 1) } }, res)

    expect(res.statusCode).toBe(413)
    expect(h2.state.connects).toHaveLength(0)
  })

  it('returns 500 when the API key is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)
    expect(res.statusCode).toBe(500)
    expect(h2.state.connects).toHaveLength(0)
  })

  it('classifies a photo over HTTP/2 and returns the full verdict', async () => {
    scriptVerdict(GRAY_LEAF_SPOT)
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(GRAY_LEAF_SPOT)

    // The transport really spoke to the Gemini endpoint shape.
    expect(h2.state.connects).toEqual(['https://generativelanguage.googleapis.com'])
    const request = h2.state.requests[0]
    expect(request.headers[':method']).toBe('POST')
    expect(request.headers[':path']).toBe('/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(request.headers['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse(request.body)
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'ZmFrZQ==' })
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT')
  })

  it('accepts a raw JSON string body', async () => {
    scriptVerdict(GRAY_LEAF_SPOT)
    const res = mockRes()

    await handler(
      {
        method: 'POST',
        body: JSON.stringify({ imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' }),
      },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(GRAY_LEAF_SPOT)
  })

  it('maps upstream failures to 502 with the error code', async () => {
    h2.state.status = 503
    h2.state.body = '{}'
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)

    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'upstream' })
  })

  it('maps auth failures to 401', async () => {
    h2.state.status = 403
    h2.state.body = '{}'
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)

    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'unauthorized' })
  })

  it('maps a transport timeout to 504 instead of hanging', async () => {
    vi.useFakeTimers()
    h2.state.noResponse = true
    const res = mockRes()

    const pending = handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)
    await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS + 1)
    await pending

    expect(res.statusCode).toBe(504)
    expect(res.payload).toMatchObject({ code: 'timeout' })
  })

  it('surfaces a transport error as a 500 without a body leak', async () => {
    h2.state.error = new Error('ECONNRESET')
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)

    expect(res.statusCode).toBe(500)
    expect(res.payload).toEqual({ error: 'Classification failed' })
  })
})
