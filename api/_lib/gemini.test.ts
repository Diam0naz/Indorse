import { describe, it, expect, vi } from 'vitest'
import { ClassificationError } from '@/features/ai/types'
import {
  classifyWithGemini,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MAX_RETRIES,
  GEMINI_VERDICT_SCHEMA,
  toGeminiSchema,
} from '@/api/_lib/gemini'
import { EVENT_DIAGNOSIS_SCHEMA, VISION_PROMPT } from '@/api/_lib/prompt'

const GRAY_LEAF_SPOT = {
  label: 'Gray Leaf Spot',
  confidence: 0.87,
  severity: 'medium',
  notes: 'Gray lesions on lower leaves.',
}

const DEPS = { apiKey: 'test-gemini-key' }

/** A buffered `generateContent` reply — verdict JSON inside `candidates`. */
function geminiResponse(verdict: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }],
      ...extra,
    }),
  } as Response
}

/** Capture the URL/headers/body the core sent to Gemini. */
function capturingFetch(reply: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return reply
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('classifyWithGemini', () => {
  it('posts a schema-constrained generateContent request and parses the verdict', async () => {
    const { fetchImpl, calls } = capturingFetch(geminiResponse(GRAY_LEAF_SPOT))

    const result = await classifyWithGemini([{ imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' }], {
      ...DEPS,
      fetchImpl,
    })

    expect(result).toEqual(GRAY_LEAF_SPOT)
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`)
    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('test-gemini-key')
    expect(headers['content-type']).toBe('application/json')

    const body = JSON.parse(String(init.body))
    expect(body.systemInstruction.parts[0].text).toBe(VISION_PROMPT)
    expect(body.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: 'ZmFrZQ==',
    })
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toEqual(GEMINI_VERDICT_SCHEMA)
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT')
  })

  it('sends every photo as consecutive parts in one request', async () => {
    const { fetchImpl, calls } = capturingFetch(geminiResponse(GRAY_LEAF_SPOT))

    await classifyWithGemini([{ imageBase64: 'b25l' }, { imageBase64: 'dHdv', mimeType: 'image/png' }], {
      ...DEPS,
      fetchImpl,
    })

    const body = JSON.parse(String(calls[0].init.body))
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'image/jpeg', data: 'b25l' } },
      { inlineData: { mimeType: 'image/png', data: 'dHdv' } },
      { text: 'Diagnose these field photos of the same plant.' },
    ])
  })

  it('honours a model override', async () => {
    const { fetchImpl, calls } = capturingFetch(geminiResponse(GRAY_LEAF_SPOT))

    await classifyWithGemini([{ imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' }], {
      ...DEPS,
      model: 'gemini-3.8-flash',
      fetchImpl,
    })

    expect(calls[0].url).toContain('/models/gemini-3.8-flash:generateContent')
  })

  it('throws unauthorized without an API key and never calls the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await expect(
      classifyWithGemini([{ imageBase64: 'ZmFrZQ==', mimeType: 'image/jpeg' }], { apiKey: '', fetchImpl }),
    ).rejects.toThrow(ClassificationError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps 401/403 to unauthorized and other failures to upstream', async () => {
    const forbidden = { ok: false, status: 401, json: async () => ({}) } as Response
    const badGateway = { ok: false, status: 502, json: async () => ({}) } as Response

    await expect(
      classifyWithGemini([{ imageBase64: 'a' }], { ...DEPS, retryDelayMs: 0, fetchImpl: fetchOf(forbidden) }),
    ).rejects.toThrow(/401/)
    await expect(
      classifyWithGemini([{ imageBase64: 'a' }], { ...DEPS, retryDelayMs: 0, fetchImpl: fetchOf(badGateway) }),
    ).rejects.toMatchObject({ code: 'upstream' })
  })

  it('retries a 503 once and succeeds on the second attempt', async () => {
    const busy = { ok: false, status: 503, json: async () => ({}) } as Response
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls === 1 ? busy : geminiResponse(GRAY_LEAF_SPOT)
    }) as unknown as typeof fetch

    const result = await classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], {
      ...DEPS,
      retryDelayMs: 0,
      fetchImpl,
    })

    expect(result).toEqual(GRAY_LEAF_SPOT)
    expect(calls).toBe(2)
  })

  it('gives up after exhausting the 503 retries', async () => {
    const busy = { ok: false, status: 503, json: async () => ({}) } as Response
    const fetchImpl = vi.fn(async () => busy) as unknown as typeof fetch

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, retryDelayMs: 0, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'upstream',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1 + GEMINI_MAX_RETRIES)
  })

  it('does not retry failures that will not self-heal', async () => {
    const bad = { ok: false, status: 400, json: async () => ({}) } as Response
    const fetchImpl = vi.fn(async () => bad) as unknown as typeof fetch

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, retryDelayMs: 0, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'upstream',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports a blocked request as a refusal', async () => {
    const { fetchImpl } = capturingFetch(geminiResponse({}, { promptFeedback: { blockReason: 'SAFETY' } }))

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('SAFETY'),
    })
  })

  it('rejects an empty candidates list', async () => {
    const { fetchImpl } = capturingFetch({ ok: true, status: 200, json: async () => ({ candidates: [] }) } as Response)

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('no diagnosis text'),
    })
  })

  it('rejects non-JSON text', async () => {
    const { fetchImpl } = capturingFetch({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'sorry, no' }] } }] }),
    } as Response)

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('non-JSON'),
    })
  })

  it('calls a MAX_TOKENS truncation a truncated diagnosis', async () => {
    const { fetchImpl } = capturingFetch({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"label": "Half' }] } }],
      }),
    } as Response)

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('truncated'),
    })
  })

  it('passes results through the shared parseClassification contract', async () => {
    const { fetchImpl } = capturingFetch(geminiResponse({ ...GRAY_LEAF_SPOT, label: 'x'.repeat(33) }))

    await expect(
      classifyWithGemini([{ imageBase64: 'a', mimeType: 'image/jpeg' }], { ...DEPS, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'malformed',
    })
  })
})

describe('toGeminiSchema / GEMINI_VERDICT_SCHEMA', () => {
  it('projects the shared OpenAI schema into Gemini dialect', () => {
    expect(GEMINI_VERDICT_SCHEMA).toEqual({
      type: 'OBJECT',
      properties: {
        label: {
          type: 'STRING',
          description: EVENT_DIAGNOSIS_SCHEMA.properties.label.description,
        },
        confidence: {
          type: 'NUMBER',
          description: EVENT_DIAGNOSIS_SCHEMA.properties.confidence.description,
        },
        severity: {
          type: 'STRING',
          enum: ['high', 'medium', 'low', 'none'],
          description: EVENT_DIAGNOSIS_SCHEMA.properties.severity.description,
        },
        notes: {
          type: 'STRING',
          description: EVENT_DIAGNOSIS_SCHEMA.properties.notes.description,
        },
      },
      required: ['label', 'confidence', 'severity', 'notes'],
    })
  })

  it('drops additionalProperties and upper-cases nested types', () => {
    const projected = toGeminiSchema({
      type: 'object',
      properties: { nested: { type: 'array' } },
      required: ['nested'],
      additionalProperties: false,
    })
    expect(projected.type).toBe('OBJECT')
    expect(projected).not.toHaveProperty('additionalProperties')
    expect((projected.properties as Record<string, { type: string }>).nested.type).toBe('ARRAY')
  })
})

/** A fetch that always replies with the given response. */
function fetchOf(reply: Response): typeof fetch {
  return vi.fn(async () => reply) as unknown as typeof fetch
}
