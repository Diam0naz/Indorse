import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
// Imported before the handler so this module is evaluated before
// `node:http2` is first requested — the factory below reads `h2` from it.
import { h2, scriptGeminiVerdict } from '../test/h2-double'
import handler from '@/api/classify'

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

/** A buffered (non-streamed) Responses reply — no `body`, text in `output`. */
function openAIResponse(verdict: { label: string; confidence: number; severity: string; notes: string }) {
  const text = JSON.stringify(verdict)
  return {
    ok: true,
    status: 200,
    json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
  }
}

const GRAY_LEAF_SPOT = {
  label: 'Gray Leaf Spot',
  confidence: 0.87,
  severity: 'medium',
  notes: 'Rectangular lesions on the lower canopy.',
}

const LEAF_RUST = {
  label: 'Leaf Rust',
  confidence: 0.6,
  severity: 'low',
  notes: 'Scattered orange pustules, mostly cosmetic.',
}

describe('api/classify handler', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test'
    // The failover key is pinned OFF for every test that does not ask for it.
    // A GEMINI_API_KEY leaked from the shell would silently turn "primary
    // failed → 502" into "silent fallback → 200" and change what each test in
    // this file means — the suite must not depend on ambient credentials.
    delete process.env.GEMINI_API_KEY
    h2.state.status = 200
    h2.state.body = '{}'
    h2.state.error = null
    h2.state.noResponse = false
    h2.state.connects.length = 0
    h2.state.requests.length = 0
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_VISION_MODEL
    delete process.env.GEMINI_API_KEY
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'a'.repeat(8 * 1024 * 1024 + 1) } }, res)

    expect(res.statusCode).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the API key is not configured', async () => {
    delete process.env.OPENAI_API_KEY
    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)
    expect(res.statusCode).toBe(500)
  })

  it('classifies a photo and returns the full diagnosis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => openAIResponse(GRAY_LEAF_SPOT)),
    )
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(GRAY_LEAF_SPOT)
  })

  it('accepts a raw JSON string body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => openAIResponse(LEAF_RUST)),
    )
    const res = mockRes()

    await handler({ method: 'POST', body: JSON.stringify({ imageBase64: 'ZmFrZQ==' }) }, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(LEAF_RUST)
  })

  it('maps an upstream model failure to 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    )
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)

    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'upstream' })
  })

  it('maps a model 401 to 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    )
    const res = mockRes()

    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==' } }, res)

    expect(res.statusCode).toBe(401)
  })

  /* ── Provider failover (api/_lib/balance.ts) ───────────────────────── */

  it('falls back to Gemini when OpenAI fails, and answers from the second provider', async () => {
    process.env.GEMINI_API_KEY = 'gem-test'
    // OpenAI is down; the request must survive that rather than surface it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    )
    scriptGeminiVerdict(GRAY_LEAF_SPOT)

    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(GRAY_LEAF_SPOT)
    // The second attempt really went over the Gemini transport…
    expect(h2.state.requests).toHaveLength(1)
  })

  it('never spends a failover round trip on a payload the route itself rejects', async () => {
    process.env.GEMINI_API_KEY = 'gem-test'
    // The oversize check runs before any provider is dialled, so the
    // fallback must stay undialled too: re-sending a payload that was
    // rejected on its own terms would only reproduce the same 413.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'a'.repeat(8 * 1024 * 1024 + 1) } }, res)

    expect(res.statusCode).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h2.state.requests).toHaveLength(0)
  })

  it('reports the PRIMARY error when every provider is down', async () => {
    process.env.GEMINI_API_KEY = 'gem-test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    )
    h2.state.status = 500
    h2.state.body = '{}'

    const res = mockRes()
    await handler({ method: 'POST', body: { imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' } }, res)

    // OpenAI's 401 is what the route's contract hangs off: a total outage
    // must not hand back Gemini's 502 and quietly redefine the endpoint.
    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'unauthorized' })
  })

  it('sends every shot in one images[] request', async () => {
    let requestBody: { input?: Array<{ content?: Array<{ type: string; image_url?: string }> }> } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body))
        return openAIResponse(GRAY_LEAF_SPOT)
      }),
    )
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
    const content = requestBody?.input?.[0]?.content ?? []
    expect(content.filter((part) => part.type === 'input_image')).toHaveLength(2)
    expect(content[0].image_url).toBe('data:image/jpeg;base64,b25l')
    expect(content[1].image_url).toBe('data:image/png;base64,dHdv')
  })

  it('rejects more than five shots before calling the model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = mockRes()

    await handler(
      {
        method: 'POST',
        body: { images: Array.from({ length: 6 }, (_, i) => ({ imageBase64: `aGk${i}` })) },
      },
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops blank entries and rejects when no usable shot remains', async () => {
    const res = mockRes()

    await handler({ method: 'POST', body: { images: [{ imageBase64: '   ' }, {}, { imageBase64: '' }] } }, res)

    expect(res.statusCode).toBe(400)
  })
})
