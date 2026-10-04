import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import handler from '@/api/classify'

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
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_VISION_MODEL
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
})
