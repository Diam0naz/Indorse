/**
 * api/assistant.ts — "Ask indorse" grounded assistant
 *
 * The safety net for a complicated four-tab app: a text-only guide that
 * answers from ONE hand-written knowledge document (`_lib/knowledge.ts`)
 * plus the app context the sheet sends (current screen, farm, policy) —
 * which is what makes an answer about THIS farm instead of a generic FAQ.
 *
 *   POST /api/assistant
 *   { "message": "What does provenance score mean?",
 *     "lang": "es",
 *     "context": { "route": "/(tabs)/farms", "hasFarm": true, "farmName": "…",
 *                  "policy": { "status": "active", "triggerMm": 120, "totalMm": 85 } } }
 *   → 200 { "reply": "…", "lang": "es" }
 *
 * Guardrails live in the system prompt (explain-only, no promises, admit
 * ignorance) and in this handler: a 1000-char message cap, an allowlisted
 * context shape, and an in-memory per-IP rate limit (30/min) so the server-
 * paid model key cannot become a free LLM for anyone who finds the URL.
 *
 * Env: GROQ_API_KEY (required), GROQ_MODEL (optional, default gpt-oss-120b).
 */

import { ClassificationError, type ClassificationErrorCode } from '@/features/ai/types'
import type { Lang } from '@/lib/i18n'
import { DEFAULT_GROQ_MODEL } from './_lib/grade'
import { buildAssistantSystem, type AssistantContext } from './_lib/knowledge'
import { parseBody, statusFor, type ProxyRequest, type ProxyResponse } from './_lib/proxy'

/** One question is a short phone message, not an essay. */
export const MAX_MESSAGE_CHARS = 1000

/** Replies are prose answers — bound them so a runaway generation stays sane. */
export const MAX_REPLY_CHARS = 4000

/** Per-IP budget: enough for real navigation help, useless as a free LLM. */
export const RATE_LIMIT = { max: 30, windowMs: 60_000 }

const LANGS: readonly string[] = ['en', 'es', 'fr']

/** Fixed-window counters keyed by client ip (or a shared bucket without one). */
const hits = new Map<string, number[]>()

/** Test seam — clears the rate-limit counters between cases. */
export function resetAssistantRateLimit(): void {
  hits.clear()
}

/** True when this client is over budget for the current window. */
export function isRateLimited(key: string, now = Date.now()): boolean {
  const windowStart = now - RATE_LIMIT.windowMs
  const recent = (hits.get(key) ?? []).filter((stamp) => stamp > windowStart)
  if (recent.length >= RATE_LIMIT.max) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  // Keep the map small even with rotating clients.
  if (hits.size > 1000) {
    for (const [otherKey, stamps] of hits) {
      if (otherKey !== key && stamps.every((stamp) => stamp <= windowStart)) hits.delete(otherKey)
    }
  }
  return false
}

/** Strip the context down to the allowlisted, length-capped shape. */
export function sanitizeContext(raw: unknown): AssistantContext | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const body = raw as Record<string, unknown>
  const context: AssistantContext = {}

  if (typeof body.route === 'string') context.route = body.route.slice(0, 64)
  if (typeof body.walletConnected === 'boolean') context.walletConnected = body.walletConnected
  if (typeof body.hasFarm === 'boolean') context.hasFarm = body.hasFarm
  if (typeof body.farmName === 'string' && body.farmName.trim().length > 0) {
    context.farmName = body.farmName.slice(0, 48)
  }

  const policy = body.policy
  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    const src = policy as Record<string, unknown>
    const clean: NonNullable<AssistantContext['policy']> = {}
    if (typeof src.status === 'string') clean.status = src.status.slice(0, 24)
    for (const key of ['coverUsdc', 'triggerMm', 'totalMm'] as const) {
      const value = src[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) clean[key] = value
    }
    if (Object.keys(clean).length > 0) context.policy = clean
  }

  return Object.keys(context).length > 0 ? context : undefined
}

/** Strip the markdown the model still emits despite the plain-text rule. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .trim()
}

/** Call Groq's chat endpoint and return the raw reply text. */
async function chatWithGroq(system: string, user: string, apiKey: string, model?: string): Promise<string> {
  let response: Response
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model ?? DEFAULT_GROQ_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // A guide bot gains nothing from creative variation: rewording the
        // same answer is just another chance to drift from the knowledge doc.
        // Deterministic replies also make the trap-question eval reproducible.
        temperature: 0,
        max_completion_tokens: 800,
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ClassificationError(
      timedOut ? 'timeout' : 'network',
      timedOut ? 'Assistant request timed out after 30000ms' : 'Assistant request failed',
    )
  }

  if (!response.ok) {
    const code: ClassificationErrorCode =
      response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream'
    throw new ClassificationError(code, `Groq responded with ${response.status}`, response.status)
  }

  let content: unknown
  try {
    const body: unknown = await response.json()
    content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
  } catch {
    throw new ClassificationError('malformed', 'Groq returned a non-JSON response')
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ClassificationError('malformed', 'Groq returned an empty reply')
  }
  return content.trim()
}

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (isRateLimited(req.ip ?? 'anonymous')) {
    res.status(429).json({ error: 'Too many requests — try again in a minute', code: 'rate-limited' })
    return
  }

  const body = parseBody(req.body)
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length === 0) {
    res.status(400).json({ error: 'message is required' })
    return
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    res.status(400).json({ error: `message must be at most ${MAX_MESSAGE_CHARS} characters` })
    return
  }

  const lang: Lang = typeof body.lang === 'string' && LANGS.includes(body.lang) ? (body.lang as Lang) : 'en'
  const context = sanitizeContext(body.context)

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: GROQ_API_KEY missing' })
    return
  }

  try {
    const system = buildAssistantSystem({ lang, context })
    const reply = stripMarkdown(await chatWithGroq(system, message, apiKey, process.env.GROQ_MODEL))
    if (reply.length === 0) {
      res.status(502).json({ error: 'Assistant returned an empty reply', code: 'malformed' })
      return
    }
    if (reply.length > MAX_REPLY_CHARS) {
      res.status(200).json({ reply: `${reply.slice(0, MAX_REPLY_CHARS)}…`, lang })
      return
    }
    res.status(200).json({ reply, lang })
  } catch (error) {
    if (error instanceof ClassificationError) {
      // An upstream quota wall is a rate limit too. Answering 502 would tell
      // the user to "try again" — straight back into the same wall — while
      // 429 lets the sheet show its wait-a-minute note and hold the retry.
      const status = error.status === 429 ? 429 : statusFor(error)
      res.status(status).json({ error: error.message, code: error.code })
      return
    }
    res.status(502).json({ error: 'Assistant failed', code: 'upstream' })
  }
}
