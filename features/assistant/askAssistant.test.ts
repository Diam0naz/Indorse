import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassificationError } from '@/features/ai/types'
import { askAssistant, getAssistantEndpoint, MAX_MESSAGE_CHARS } from '@/features/assistant/askAssistant'

const ENDPOINT = 'http://test.local/api/assistant'
const REPLY = 'The provenance score is verified reports over total reports.'

function okResponse(reply: string, lang = 'en') {
  return { ok: true, status: 200, json: async () => ({ reply, lang }) } as Response
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({ error: 'nope' }) } as Response
}

describe('getAssistantEndpoint', () => {
  it('reads the public env trimmed, and null when unset', () => {
    process.env.EXPO_PUBLIC_AI_ASSISTANT_URL = '  http://localhost:3000/api/assistant  '
    expect(getAssistantEndpoint()).toBe('http://localhost:3000/api/assistant')

    delete process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
    expect(getAssistantEndpoint()).toBeNull()
  })
})

describe('askAssistant', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_ASSISTANT_URL = ENDPOINT
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
  })

  it('posts message, lang and context, and parses the reply', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(REPLY))

    const result = await askAssistant('What is the score?', {
      lang: 'es',
      context: { route: '/farms', hasFarm: true },
      fetchImpl,
    })

    expect(result).toEqual({ reply: REPLY, lang: 'en' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      message: 'What is the score?',
      lang: 'es',
      context: { route: '/farms', hasFarm: true },
    })
  })

  it('omits an absent context from the payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(REPLY))
    await askAssistant('hello', { fetchImpl })
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({ message: 'hello', lang: 'en' })
    expect('context' in body).toBe(false)
  })

  it('rejects an empty message, an oversized message and a missing endpoint', async () => {
    await expect(askAssistant('   ', { fetchImpl: vi.fn() })).rejects.toMatchObject({ code: 'bad-request' })

    await expect(askAssistant('x'.repeat(MAX_MESSAGE_CHARS + 1), { fetchImpl: vi.fn() })).rejects.toMatchObject({
      code: 'bad-request',
    })

    delete process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
    await expect(askAssistant('hi', { fetchImpl: vi.fn() })).rejects.toMatchObject({
      code: 'bad-request',
      message: 'assistant endpoint is not configured',
    })
  })

  it('carries the upstream status on failures so callers can see 429 vs 5xx', async () => {
    const unauthorized = vi.fn().mockResolvedValue(errorResponse(401))
    await expect(askAssistant('hi', { fetchImpl: unauthorized })).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })

    const rate = vi.fn().mockResolvedValue(errorResponse(429))
    const error = await askAssistant('hi', { fetchImpl: rate }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ClassificationError)
    expect((error as ClassificationError).status).toBe(429)

    const upstream = vi.fn().mockResolvedValue(errorResponse(503))
    await expect(askAssistant('hi', { fetchImpl: upstream })).rejects.toMatchObject({
      code: 'upstream',
      status: 503,
    })
  })

  it('rejects malformed payloads — never unvalidated text on screen', async () => {
    const empty = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ reply: '  ' }) })
    await expect(askAssistant('hi', { fetchImpl: empty })).rejects.toMatchObject({ code: 'malformed' })

    const notObject = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => 'just a string' })
    await expect(askAssistant('hi', { fetchImpl: notObject })).rejects.toMatchObject({ code: 'malformed' })
  })

  it('reports a network failure as network, not as a crash', async () => {
    const down = vi.fn().mockRejectedValue(new Error('socket hang up'))
    await expect(askAssistant('hi', { fetchImpl: down })).rejects.toMatchObject({ code: 'network' })
  })
})
