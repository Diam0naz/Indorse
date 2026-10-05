import { describe, it, expect, vi } from 'vitest'
import { classifyWithOpenAI, DEFAULT_VISION_MODEL, EVENT_DIAGNOSIS_SCHEMA, VISION_PROMPT } from '@/api/_lib/openai'

/** Encode SSE events into a real `ReadableStream` so the parser runs for real. */
function streamOf(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = events.map((event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[index++])
    },
  })
}

/** A streamed success: text arrives as deltas, then the terminal event. */
function streamFetch(verdictJson: string, extra: unknown[] = []): typeof fetch {
  const events = [
    { type: 'response.created' },
    ...split(verdictJson).map((piece) => ({ type: 'response.output_text.delta', delta: piece })),
    ...extra,
    { type: 'response.completed' },
  ]
  return vi.fn(async () => ({ ok: true, status: 200, body: streamOf(events) })) as unknown as typeof fetch
}

/** Cut a string into uneven pieces so deltas straddle JSON boundaries. */
function split(text: string): string[] {
  const size = Math.max(1, Math.ceil(text.length / 4))
  const pieces: string[] = []
  for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size))
  return pieces
}

const VERDICT = {
  label: 'Northern Corn Leaf Blight',
  confidence: 0.74,
  severity: 'medium',
  notes: 'Tan cigar-shaped lesions on the upper canopy.',
}

/** Buffered fallback: no `body`, final text read from the `output` array. */
function bufferedFetch(verdict: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    body: null,
    json: async () => ({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(verdict) }] }],
    }),
  })) as unknown as typeof fetch
}

function errorFetch(status: number): typeof fetch {
  return vi.fn(async () => ({ ok: false, status, json: async () => ({}) })) as unknown as typeof fetch
}

describe('classifyWithOpenAI', () => {
  it('sends a streamed Responses request with a strict json_schema verdict', async () => {
    const fetchImpl = streamFetch(JSON.stringify(VERDICT))

    const result = await classifyWithOpenAI([{ imageBase64: 'ZmFrZQ==', mimeType: 'image/png' }], {
      apiKey: 'sk-test',
      fetchImpl,
    })

    expect(result).toEqual(VERDICT)

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const request = init as RequestInit & { headers: Record<string, string> }
    expect(request.headers.authorization).toBe('Bearer sk-test')

    const body = JSON.parse(request.body as string)
    expect(body.model).toBe(DEFAULT_VISION_MODEL)
    expect(body.stream).toBe(true)
    expect(body.instructions).toBe(VISION_PROMPT)
    expect(body.store).toBeUndefined()
    expect(body.reasoning).toBeUndefined()
    expect(body.include).toBeUndefined()

    // The verdict is a strict schema, not a free-form JSON object.
    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: 'event_diagnosis',
      strict: true,
      schema: EVENT_DIAGNOSIS_SCHEMA,
    })
    expect(EVENT_DIAGNOSIS_SCHEMA.required).toEqual(['label', 'confidence', 'severity', 'notes'])
    expect(EVENT_DIAGNOSIS_SCHEMA.additionalProperties).toBe(false)
    expect(EVENT_DIAGNOSIS_SCHEMA.properties.severity.enum).toEqual(['high', 'medium', 'low', 'none'])

    // The image rides along as a high-detail data URL.
    const content = body.input[0].content
    const image = content.find((part: { type: string }) => part.type === 'input_image')
    expect(image.image_url).toBe('data:image/png;base64,ZmFrZQ==')
    expect(image.detail).toBe('high')
  })

  it('sends every photo as consecutive input_image parts, in order', async () => {
    const fetchImpl = streamFetch(JSON.stringify(VERDICT))
    await classifyWithOpenAI([{ imageBase64: 'b25l' }, { imageBase64: 'dHdv', mimeType: 'image/png' }], {
      apiKey: 'sk-test',
      fetchImpl,
    })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const content = JSON.parse((init as RequestInit).body as string).input[0].content
    expect(content.map((part: { type: string }) => part.type)).toEqual(['input_image', 'input_image', 'input_text'])
    expect(content[0].image_url).toBe('data:image/jpeg;base64,b25l')
    expect(content[1].image_url).toBe('data:image/png;base64,dHdv')
    expect(content[2].text).toBe('Diagnose these field photos of the same plant.')
  })

  it('reassembles deltas that straddle JSON boundaries', async () => {
    const fetchImpl = streamFetch(JSON.stringify(VERDICT))
    const result = await classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })
    expect(result).toEqual(VERDICT)
  })

  it('reads a buffered reply when the host stripped the stream', async () => {
    const fetchImpl = bufferedFetch(VERDICT)
    const result = await classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })
    expect(result).toEqual(VERDICT)
  })

  it('honours a model override', async () => {
    const fetchImpl = streamFetch(JSON.stringify(VERDICT))
    await classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', model: 'gpt-4o', fetchImpl })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string).model).toBe('gpt-4o')
  })

  it('rejects a missing API key without calling the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await expect(classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: '', fetchImpl })).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps 401 to unauthorized and 500 to upstream', async () => {
    await expect(
      classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl: errorFetch(401) }),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    await expect(
      classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl: errorFetch(500) }),
    ).rejects.toMatchObject({ code: 'upstream', status: 500 })
  })

  it('surfaces a failed stream as an upstream error', async () => {
    const fetchImpl = streamFetch(JSON.stringify(VERDICT), [
      { type: 'response.failed', response: { error: { message: 'model overloaded' } } },
    ])
    await expect(classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })).rejects.toMatchObject({
      code: 'upstream',
      message: 'model overloaded',
    })
  })

  it('reports a truncated stream as malformed', async () => {
    const events = [{ type: 'response.output_text.delta', delta: '{"label":' }, { type: 'response.incomplete' }]
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: streamOf(events) })) as unknown as typeof fetch
    await expect(classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('truncated'),
    })
  })

  it('rejects a verdict the app contract would not accept', async () => {
    const fetchImpl = streamFetch(JSON.stringify({ label: 'Rust', confidence: 0.5, severity: 'critical', notes: 'x' }))
    await expect(classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('severity'),
    })
  })

  it('rejects non-JSON text', async () => {
    const fetchImpl = streamFetch('sure, here is your diagnosis: rust')
    await expect(classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })).rejects.toMatchObject({
      code: 'malformed',
      message: expect.stringContaining('non-JSON'),
    })
  })

  it('rejects an empty stream', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: streamOf([]) })) as unknown as typeof fetch
    await expect(classifyWithOpenAI([{ imageBase64: 'x' }], { apiKey: 'k', fetchImpl })).rejects.toMatchObject({
      code: 'malformed',
    })
  })
})
