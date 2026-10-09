/**
 * api/_lib/gemini.ts — Google Gemini vision core for the classification proxy
 *
 * The Gemini counterpart of `_lib/openai.ts`: same shared prompt, same
 * `parseClassification` edge, same `ClassificationError` vocabulary — only the
 * wire format differs. Kept separate from the HTTP handler so request-building
 * and response parsing are unit-testable with an injected fetch; underscore-
 * prefixed directories are not treated as routes by Vercel.
 *
 * Uses `v1beta/models/{model}:generateContent` with a `responseSchema`, so
 * the model must answer `{ label, confidence, severity, notes }` as JSON in a
 * single complete body (no streaming). Auth is the `x-goog-api-key` header —
 * a Google AI Studio key, never shipped to the client.
 *
 * Transport: production calls go over HTTP/2 (`h2Fetch`, below) rather than
 * the global `fetch`, for two reasons — Node's fetch is HTTP/1.1-only and
 * some networks (this POC's mobile uplink) blackhole H1 POSTs to Google's
 * edge while H2 sails through; and H2 gives us a hard request deadline, so a
 * stalled network surfaces as a mapped `timeout` instead of a hung proxy.
 * Tests bypass it entirely with an injected `fetchImpl`.
 */

import {
  ClassificationError,
  parseClassification,
  DEFAULT_MIME_TYPE,
  type ClassificationResult,
  type ImageInput,
} from './ai-types'
import { EVENT_DIAGNOSIS_SCHEMA, VISION_PROMPT } from './prompt'
import { connect as http2Connect } from 'node:http2'

/**
 * Diagnosis model. Override with GEMINI_MODEL.
 *
 * Defaults to the flash-lite workhorse: it is multimodal, well within the
 * free tier (the newer `gemini-3.8-flash` allows only ~20 free requests,
 * which a field app burns in a day), and answers comfortably under deadline.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

/**
 * Hard deadline for one Gemini call — a stall becomes a mapped 504, not a hang.
 *
 * The route fails over Gemini → OpenAI, so the WHOLE request must finish
 * inside the app's client deadline (`CLASSIFY_TIMEOUT_MS`, 45 s): 20 s here
 * plus the fallback's own 20 s (`OPENAI_TIMEOUT_MS`) fits with room to spare,
 * so a stalled primary still yields a verdict instead of the app aborting
 * mid-failover. A healthy vision call answers in a few seconds, so 20 s only
 * ever cuts off a dead connection.
 */
export const GEMINI_TIMEOUT_MS = 20_000

/** Backoff before each 503/429 retry (Gemini capacity spikes are short). */
export const GEMINI_RETRY_DELAY_MS = 500

/** Extra attempts after the first when Gemini answers 503/429. */
export const GEMINI_MAX_RETRIES = 2

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/** The JSON-schema subset Gemini's `Schema` accepts, in its dialect. */
interface GeminiSchemaNode {
  type?: string
  description?: string
  enum?: readonly string[]
  properties?: Record<string, GeminiSchemaNode>
  required?: readonly string[]
  /** Present in the shared OpenAI schema; Gemini doesn't take it (ignored). */
  additionalProperties?: boolean
}

/**
 * Project the shared verdict schema into Gemini's `Schema` dialect: uppercase
 * `type` values, no `additionalProperties` (Gemini pins the shape from
 * `required` alone). Deriving it from `EVENT_DIAGNOSIS_SCHEMA` keeps the two
 * providers' contracts from drifting apart.
 */
export function toGeminiSchema(node: GeminiSchemaNode): Record<string, unknown> {
  const projected: Record<string, unknown> = { type: (node.type ?? 'string').toUpperCase() }
  if (node.description) projected.description = node.description
  if (node.enum) projected.enum = [...node.enum]
  if (node.properties) {
    projected.properties = Object.fromEntries(
      Object.entries(node.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    )
    projected.required = node.required ? [...node.required] : Object.keys(node.properties)
  }
  return projected
}

export const GEMINI_VERDICT_SCHEMA = toGeminiSchema(EVENT_DIAGNOSIS_SCHEMA)

export interface GeminiClassifyDeps {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
  /** Backoff before retrying a 503/429; tests set 0 to stay instant. */
  retryDelayMs?: number
  /**
   * Budget for this attempt. The failover (`_lib/balance.ts`) sets it so a
   * stalled primary leaves time for the OpenAI fallback; direct callers keep
   * the `GEMINI_TIMEOUT_MS` default.
   */
  timeoutMs?: number
}

/** Shape of a `generateContent` reply — only the parts that carry text. */
interface GeminiPayload {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
  promptFeedback?: { blockReason?: string }
}

/**
 * Call the Gemini vision model and return a validated classification.
 * Every image arrives in one `generateContent` call, so a single verdict
 * weighs all the scout's shots of the plant together.
 */
export async function classifyWithGemini(
  images: ImageInput[],
  deps: GeminiClassifyDeps,
): Promise<ClassificationResult> {
  if (images.length === 0) {
    throw new ClassificationError('bad-request', 'classifyWithGemini requires at least one image')
  }
  if (!deps.apiKey) {
    throw new ClassificationError('unauthorized', 'GEMINI_API_KEY is not configured')
  }

  // The H2 transport carries this attempt's deadline; a healthy call answers
  // in seconds, so the budget only ever cuts off a dead connection.
  const fetchImpl =
    deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => h2Fetch(input, init, deps.timeoutMs))
  const model = deps.model ?? DEFAULT_GEMINI_MODEL
  const response = await sendWithRetry(
    () =>
      fetchImpl(`${GEMINI_BASE_URL}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': deps.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: VISION_PROMPT }] },
          contents: [
            {
              role: 'user',
              parts: [
                ...images.map((image) => ({
                  inlineData: { mimeType: image.mimeType ?? DEFAULT_MIME_TYPE, data: image.imageBase64 },
                })),
                {
                  text:
                    images.length > 1 ? 'Diagnose these field photos of the same plant.' : 'Diagnose this field photo.',
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_VERDICT_SCHEMA,
            temperature: 0.2,
          },
        }),
      }),
    deps.retryDelayMs ?? GEMINI_RETRY_DELAY_MS,
  )

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream'
    throw new ClassificationError(code, `Gemini responded with ${response.status}`, response.status)
  }

  const payload: unknown = await response.json()
  const { text, blocked, incomplete } = extractText(payload)

  if (blocked) {
    throw new ClassificationError('malformed', `Gemini refused to diagnose this image (${blocked})`)
  }

  const trimmed = text.trim()
  if (trimmed.length === 0) {
    const message = incomplete ? 'Gemini returned a truncated diagnosis' : 'Gemini returned no diagnosis text'
    throw new ClassificationError('malformed', message)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const message = incomplete ? 'Gemini returned a truncated diagnosis' : 'Gemini returned non-JSON content'
    throw new ClassificationError('malformed', message)
  }

  return parseClassification(parsed)
}

/**
 * One request plus up to `GEMINI_MAX_RETRIES` retries when Gemini answers
 * 503/429 — free-tier capacity spikes are brief but frequent and strike any
 * model at random, so a couple of quick retries turn most of them into a
 * verdict instead of a 502 to the app. Non-transient failures return at once.
 */
export async function sendWithRetry(send: () => Promise<Response>, retryDelayMs: number): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await send()
    const transient = response.status === 503 || response.status === 429
    if (!transient || attempt >= GEMINI_MAX_RETRIES) return response
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }
}

/** Read the verdict text out of a buffered `generateContent` payload. */
export function extractText(payload: unknown): { text: string; blocked: string | null; incomplete: boolean } {
  if (!payload || typeof payload !== 'object') return { text: '', blocked: null, incomplete: false }
  const body = payload as GeminiPayload

  const blockReason = body.promptFeedback?.blockReason
  if (blockReason) return { text: '', blocked: blockReason, incomplete: false }

  let text = ''
  let incomplete = false
  for (const candidate of body.candidates ?? []) {
    if (candidate.finishReason === 'MAX_TOKENS') incomplete = true
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === 'string') text += part.text
    }
  }
  return { text, blocked: null, incomplete }
}

/**
 * Minimal `fetch`-shaped client speaking HTTP/2 (`node:http2`), used as the
 * default transport. Equivalent to the global `fetch` for this call's needs
 * (one buffered GET/POST body in, one `Response` out) but it (a) rides H2,
 * which is what actually gets through to Google's edge on restricted
 * networks, and (b) enforces its `timeoutMs` (defaulting to
 * `GEMINI_TIMEOUT_MS`), rejecting with a mapped `timeout` error instead of
 * leaving the proxy hanging.
 */
export async function h2Fetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = GEMINI_TIMEOUT_MS,
): Promise<Response> {
  const url = new URL(String(input))
  const body = typeof init?.body === 'string' ? init.body : ''

  return new Promise<Response>((resolve, reject) => {
    let settled = false
    const client = http2Connect(`${url.protocol}//${url.host}`)

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.destroy()
      reject(error)
    }

    const timer = setTimeout(() => {
      fail(new ClassificationError('timeout', `Gemini request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    // A pending request is not a valid reason to hold the event loop open.
    timer.unref?.()

    client.on('error', fail)

    const headers: Record<string, string | number> = {
      ':method': init?.method ?? 'GET',
      ':path': `${url.pathname}${url.search}`,
    }
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value
    }

    const req = client.request(headers)
    const chunks: string[] = []
    let status = 0

    req.setEncoding('utf8')
    req.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status'] ?? 0)
    })
    req.on('data', (chunk: string) => chunks.push(chunk))
    req.on('error', fail)
    req.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.close()
      resolve(
        new Response(chunks.join(''), {
          status: status || 500,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    req.end(body)
  })
}
