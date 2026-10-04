/**
 * api/_lib/openai.ts — OpenAI vision core for the classification proxy
 *
 * Kept separate from the HTTP handler so the request-building and response
 * parsing can be unit-tested with an injected fetch. Underscore-prefixed
 * directories are not treated as routes by Vercel.
 *
 * Uses the Responses API with a strict `json_schema` output contract, so the
 * model must answer `{ label, confidence, severity, notes }`. The request is
 * streamed (`stream: true`) and the `response.output_text.delta` chunks are
 * reassembled here — streaming is an upstream choice only; `api/classify.ts`
 * still answers the app with one complete JSON body.
 *
 * No `store` (nothing durable should keep a farmer's photo), no `reasoning.*`,
 * no `include` — this call has no tools, so include would be a no-op.
 */

import {
  ClassificationError,
  toDataUrl,
  parseClassification,
  DEFAULT_MIME_TYPE,
  type ClassificationResult,
} from '@/features/ai/types'
import { EVENT_DIAGNOSIS_SCHEMA, VISION_PROMPT } from './prompt'

// The prompt/schema pair lives in `_lib/prompt.ts` (shared with the Gemini
// route); re-exported here so existing imports keep working.
export { CROP_DISEASE_LABELS, EVENT_DIAGNOSIS_SCHEMA, VISION_PROMPT } from './prompt'

/** Diagnosis model. Override with OPENAI_VISION_MODEL. */
export const DEFAULT_VISION_MODEL = 'gpt-6-astra'

const OPENAI_URL = 'https://api.openai.com/v1/responses'

export interface OpenAIClassifyDeps {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
}

/** Shape of the SSE events we care about; everything else is progress noise. */
interface StreamEvent {
  type?: string
  delta?: unknown
  message?: unknown
  response?: { error?: { message?: string } }
}

interface DiagnosisStream {
  text: string
  /** Terminal stream error (`response.failed` / `error`) — an upstream fault. */
  failure: string | null
  /** The stream ended without a complete message (e.g. output-token cap). */
  incomplete: boolean
  refused: boolean
}

/** Call the OpenAI vision model and return a validated classification. */
export async function classifyWithOpenAI(
  imageBase64: string,
  mimeType: string | undefined,
  deps: OpenAIClassifyDeps,
): Promise<ClassificationResult> {
  if (!deps.apiKey) {
    throw new ClassificationError('unauthorized', 'OPENAI_API_KEY is not configured')
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const response = await fetchImpl(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${deps.apiKey}`,
    },
    body: JSON.stringify({
      model: deps.model ?? DEFAULT_VISION_MODEL,
      instructions: VISION_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: toDataUrl(imageBase64, mimeType ?? DEFAULT_MIME_TYPE), detail: 'high' },
            { type: 'input_text', text: 'Diagnose this field photo.' },
          ],
        },
      ],
      stream: true,
      text: {
        format: { type: 'json_schema', name: 'event_diagnosis', strict: true, schema: EVENT_DIAGNOSIS_SCHEMA },
      },
    }),
  })

  if (!response.ok) {
    const code = response.status === 401 ? 'unauthorized' : 'upstream'
    throw new ClassificationError(code, `OpenAI responded with ${response.status}`, response.status)
  }

  const stream = await readDiagnosisText(response)
  if (stream.failure) {
    throw new ClassificationError('upstream', stream.failure)
  }
  if (stream.refused) {
    throw new ClassificationError('malformed', 'OpenAI refused to diagnose this image')
  }

  const text = stream.text.trim()
  if (text.length === 0) {
    const message = stream.incomplete ? 'OpenAI returned a truncated diagnosis' : 'OpenAI returned no diagnosis text'
    throw new ClassificationError('malformed', message)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A cut-off stream leaves partial JSON behind; say so instead of blaming the content.
    const message = stream.incomplete ? 'OpenAI returned a truncated diagnosis' : 'OpenAI returned non-JSON content'
    throw new ClassificationError('malformed', message)
  }

  return parseClassification(parsed)
}

/**
 * Reassemble the streamed `response.output_text.delta` chunks into one string.
 * A host that buffered the reply (or a test injecting a plain JSON body) has
 * no `body`, so we fall back to reading the final `output_text` from JSON.
 */
async function readDiagnosisText(response: Response): Promise<DiagnosisStream> {
  if (!response.body) {
    return {
      text: extractOutputText(await response.json()),
      failure: null,
      incomplete: false,
      refused: false,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let text = ''
  let failure: string | null = null
  let incomplete = false
  let refused = false

  const handleLine = (raw: string): void => {
    const line = raw.replace(/\r$/, '')
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (payload.length === 0 || payload === '[DONE]') return

    let event: StreamEvent
    try {
      event = JSON.parse(payload) as StreamEvent
    } catch {
      return
    }

    switch (event.type) {
      case 'response.output_text.delta':
        text += typeof event.delta === 'string' ? event.delta : ''
        break
      case 'response.refusal.delta':
      case 'response.refusal.done':
        refused = true
        break
      case 'response.incomplete':
        incomplete = true
        break
      case 'response.failed':
        failure = event.response?.error?.message ?? 'OpenAI response failed'
        break
      case 'error':
        failure = typeof event.message === 'string' ? event.message : 'OpenAI stream error'
        break
      default:
        // created / in_progress / completed / item events carry no text.
        break
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
      if (failure) break
    }
    if (!failure && pending.length > 0) handleLine(pending + decoder.decode())
  } finally {
    if (failure) {
      // Stop paying for a stream whose verdict we will discard.
      await reader.cancel().catch(() => undefined)
    }
  }

  return { text, failure, incomplete, refused }
}

/** Read `output_text` from a buffered Responses payload (no streaming). */
function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const body = payload as { output_text?: unknown; output?: unknown }
  if (typeof body.output_text === 'string') return body.output_text
  if (!Array.isArray(body.output)) return ''

  let text = ''
  for (const item of body.output) {
    const content = (item as { content?: unknown } | null)?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const typed = part as { type?: unknown; text?: unknown } | null
      if (typed?.type === 'output_text' && typeof typed.text === 'string') text += typed.text
    }
  }
  return text
}
