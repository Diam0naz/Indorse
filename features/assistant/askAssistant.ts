/**
 * features/assistant/askAssistant.ts — "Ask indorse" client
 *
 * The app-side counterpart of `api/assistant.ts`: a short question goes out
 * with a small, honest context block (which screen, whether a farm exists,
 * the active policy) and a grounded reply comes back from the assistant's
 * hand-written knowledge document.
 *
 * Safety lives on both sides. This client only ever sends the allowlisted
 * fields below — never keys, emails or raw account dumps — and the server
 * caps message length, rate-limits per IP and answers from the doc alone.
 *
 *   const reply = await askAssistant('What does provenance score mean?', {
 *     context: { route: '/farms', hasFarm: true, farmName: 'Blue Berry' },
 *     lang,
 *   })
 */

import { ClassificationError } from '@/features/ai/types'
import type { Lang } from '@/lib/i18n'

/**
 * What the sheet sends about this user. Mirrors `AssistantContext` in
 * `api/_lib/knowledge.ts` — duplicated (type-only) so the client bundle
 * never pulls server prompt code into Metro.
 */
export interface AssistantContext {
  /** Current route, e.g. `/farms`. */
  route?: string
  walletConnected?: boolean
  hasFarm?: boolean
  farmName?: string | null
  /** Latest parametric policy — best-effort, absent while loading. */
  policy?: {
    status?: string
    coverUsdc?: number
    triggerMm?: number
    totalMm?: number
  } | null
}

export interface AssistantReply {
  reply: string
  lang: Lang
}

export interface AskAssistantOptions {
  /** Full URL of the assistant proxy. Defaults to `EXPO_PUBLIC_AI_ASSISTANT_URL`. */
  endpoint?: string
  lang?: Lang
  context?: AssistantContext
  /** Injectable fetch for tests / custom transports. */
  fetchImpl?: typeof fetch
  /** Abort after this many milliseconds. Default 30s (matches the server). */
  timeoutMs?: number
  /** Caller-owned abort signal (e.g. a closed sheet). */
  signal?: AbortSignal
}

/**
 * Client deadline for one question. The server's Groq → OpenAI failover runs
 * inside a SINGLE shared budget (`ASSISTANT_TOTAL_BUDGET_MS`, 26 s in
 * `api/assistant.ts`) beneath this, so a slow primary still lands a reply
 * instead of the sheet aborting mid-failover. Raising either side alone
 * re-opens that gap; `api/assistant.test.ts` pins the ordering.
 */
export const DEFAULT_ASSISTANT_TIMEOUT_MS = 30_000

/** Reply cap — mirrors the server's `MAX_REPLY_CHARS`. */
export const MAX_REPLY_CHARS = 4000

/** One question is a short phone message — mirrors the server's cap. */
export const MAX_MESSAGE_CHARS = 1000

/**
 * Read the assistant URL from Expo's public env. `null` when unset so the
 * sheet can say "not configured" honestly instead of failing oddly.
 */
export function getAssistantEndpoint(): string | null {
  const url = process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

/** Ask the grounded assistant one question. */
export async function askAssistant(message: string, options: AskAssistantOptions = {}): Promise<AssistantReply> {
  const {
    endpoint = getAssistantEndpoint(),
    lang = 'en',
    context,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_ASSISTANT_TIMEOUT_MS,
    signal,
  } = options

  const trimmed = message.trim()
  if (trimmed.length === 0) {
    throw new ClassificationError('bad-request', 'askAssistant requires a message')
  }
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    throw new ClassificationError('bad-request', `message must be at most ${MAX_MESSAGE_CHARS} characters`)
  }
  if (!endpoint) {
    throw new ClassificationError('bad-request', 'assistant endpoint is not configured')
  }

  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: trimmed, lang, ...(context ? { context } : {}) }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : 'upstream'
      throw new ClassificationError(code, `Assistant responded with ${response.status}`, response.status)
    }

    return parseAssistantReply(await response.json(), lang)
  } catch (error) {
    if (error instanceof ClassificationError) throw error
    if (isAbortError(error)) {
      throw new ClassificationError(
        timedOut ? 'timeout' : 'network',
        timedOut ? `Assistant timed out after ${timeoutMs}ms` : 'Assistant request was cancelled',
      )
    }
    throw new ClassificationError('network', error instanceof Error ? error.message : 'Assistant request failed')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Narrow the proxy payload into a validated reply — a drifting upstream
 * must never put unvalidated text on screen as if it were an answer.
 */
export function parseAssistantReply(raw: unknown, fallbackLang: Lang): AssistantReply {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ClassificationError('malformed', 'Assistant returned a non-object payload')
  }
  const { reply, lang } = raw as Record<string, unknown>

  if (typeof reply !== 'string' || reply.trim().length === 0) {
    throw new ClassificationError('malformed', 'Assistant returned an empty reply')
  }
  if (reply.length > MAX_REPLY_CHARS + 1) {
    throw new ClassificationError('malformed', 'Assistant returned an over-long reply')
  }

  const replyLang: Lang = lang === 'en' || lang === 'es' || lang === 'fr' ? lang : fallbackLang
  return { reply: reply.trim(), lang: replyLang }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
