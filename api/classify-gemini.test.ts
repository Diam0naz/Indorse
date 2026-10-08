import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
// Imported BEFORE the handler so this module is evaluated before
// `node:http2` is first requested — the factory below reads `h2` from it.
import { h2, scriptGeminiVerdict } from '../test/h2-double'
import handler from '@/api/classify-gemini'
import { GEMINI_TIMEOUT_MS } from '@/api/_lib/gemini'

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

const GRAY_LEAF_SPOT = {
  label: 'Gray Leaf Spot',
  confidence: 0.87,
  severity: 'medium',
  notes: 'Gray lesions on lower leaves.',
}

describe('POST /api/classify-gemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    // Pinned OFF unless a test opts in — a leaked OPENAI_API_KEY would turn
    // "primary failed → 502" into a silent fallback, changing what every
    // other test in this file means.
    delete process.env.OPENAI_API_KEY
    h2.state.status = 200
    h2.state.body = '{}'
    h2.state.error = null
    h2.state.noResponse = false
    h2.state.connects.length = 0
    h2.state.requests.length = 0
  })

  afterEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENAI_API_KEY
    vi.unstubAllGlobals()
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
    scriptGeminiVerdict(GRAY_LEAF_SPOT)
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
    scriptGeminiVerdict(GRAY_LEAF_SPOT)
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

  /* ── Provider failover (api/_lib/balance.ts) ───────────────────────── */

  it('falls back to OpenAI when Gemini fails, and answers from the second provider', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    h2.state.status = 500 // 503/429 would retry inside Gemini first — not here.
    h2.state.body = '{}'
    const openai = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(GRAY_LEAF_SPOT) }] }],
      }),
    }))
    vi.stubGlobal('fetch', openai)

    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(GRAY_LEAF_SPOT)
    // The primary was tried first and really failed over — one Gemini
    // request, then exactly one OpenAI request.
    expect(h2.state.requests).toHaveLength(1)
    expect(openai).toHaveBeenCalledTimes(1)
  })

  it('reports the PRIMARY error when every provider is down', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    h2.state.status = 500
    h2.state.body = '{}'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    )

    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' } }, res)

    // Gemini is this route's primary: its 502 is the contract, and OpenAI's
    // 401 must not overwrite it just because it was tried last.
    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'upstream' })
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

  it('sends every shot as parts of one request', async () => {
    scriptGeminiVerdict(GRAY_LEAF_SPOT)
    const res = mockRes()

    await handler(
      {
        method: 'POST',
        body: { images: [{ imageBase64: 'b25l' }, { imageBase64: 'dHdv', mimeType: 'image/png' }] },
      },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(GRAY_LEAF_SPOT)
    const body = JSON.parse(h2.state.requests[0].body)
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'image/jpeg', data: 'b25l' } },
      { inlineData: { mimeType: 'image/png', data: 'dHdv' } },
      { text: 'Diagnose these field photos of the same plant.' },
    ])
  })

  it('rejects more than five shots before dialling the model', async () => {
    const res = mockRes()

    await handler(
      {
        method: 'POST',
        body: { images: Array.from({ length: 6 }, (_, i) => ({ imageBase64: `aGk${i}` })) },
      },
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(h2.state.connects).toHaveLength(0)
  })
})
