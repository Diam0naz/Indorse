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
 * Env: GROQ_API_KEY (primary), OPENAI_API_KEY (failover — a Groq quota wall
 * or outage answers from OpenAI; only a client fault fails fast),
 * GROQ_MODEL (optional, default gpt-oss-120b), OPENAI_ASSISTANT_MODEL
 * (optional, defaults to the OpenAI vision model).
 */

import { ClassificationError, type ClassificationErrorCode } from './_lib/ai-types'
import type { Lang } from '@/lib/i18n'
import { balanceProviders, type ProviderAttempt } from './_lib/balance'
import { DEFAULT_GROQ_MODEL } from './_lib/grade'
import { DEFAULT_VISION_MODEL } from './_lib/openai'
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

/** One provider slot of the chat failover — both speak the OpenAI wire shape. */
interface ChatProvider {
  /** Human name used in error messages (Groq → OpenAI preserves its wording). */
  label: string
  baseUrl: string
  apiKey: string
  model: string
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

/**
 * Wall-clock budget shared by the Groq → OpenAI failover. Sits under the app's
 * client deadline (`DEFAULT_ASSISTANT_TIMEOUT_MS`, 30 s) so a slow primary
 * still yields a reply instead of the sheet aborting mid-failover — with two
 * independent 30 s provider windows the fallback could never finish in time.
 */
export const ASSISTANT_TOTAL_BUDGET_MS = 26_000

/** Primary ceiling — leaves the bulk of the shared budget to the failover. */
export const ASSISTANT_PRIMARY_BUDGET_MS = 12_000

/** Call an OpenAI-compatible chat endpoint and return the raw reply text. */
async function chatCompletion(
  system: string,
  user: string,
  provider: ChatProvider,
  timeoutMs: number,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
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
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ClassificationError(
      timedOut ? 'timeout' : 'network',
      timedOut ? `Assistant request timed out after ${timeoutMs}ms` : 'Assistant request failed',
    )
  }

  if (!response.ok) {
    const code: ClassificationErrorCode =
      response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream'
    throw new ClassificationError(code, `${provider.label} responded with ${response.status}`, response.status)
  }

  let content: unknown
  try {
    const body: unknown = await response.json()
    content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
  } catch {
    throw new ClassificationError('malformed', `${provider.label} returned a non-JSON response`)
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ClassificationError('malformed', `${provider.label} returned an empty reply`)
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

  const groqKey = process.env.GROQ_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!groqKey && !openaiKey) {
    // No provider at all keeps the original misconfigured contract.
    res.status(500).json({ error: 'Server misconfigured: GROQ_API_KEY missing' })
    return
  }

  try {
    const system = buildAssistantSystem({ lang, context })
    // Ordered failover: Groq answers when healthy, OpenAI takes over on
    // provider-side failures (quota wall, outage, dead key); a total outage
    // reports the primary's error unchanged (see _lib/balance.ts).
    // One shared budget (see _lib/balance.ts): the primary is capped so it
    // cannot consume the invocation, and the fallback spends whatever is left
    // — all of it under the app's 30 s client deadline.
    const attempts: ProviderAttempt<string>[] = []
    if (groqKey) {
      attempts.push({
        name: 'groq',
        budgetMs: ASSISTANT_PRIMARY_BUDGET_MS,
        run: (timeoutMs) =>
          chatCompletion(
            system,
            message,
            {
              label: 'Groq',
              baseUrl: GROQ_CHAT_URL,
              apiKey: groqKey,
              model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
            },
            timeoutMs,
          ),
      })
    }
    if (openaiKey) {
      attempts.push({
        name: 'openai',
        // No cap: the failover gets whatever the primary left unused.
        run: (timeoutMs) =>
          chatCompletion(
            system,
            message,
            {
              label: 'OpenAI',
              baseUrl: OPENAI_CHAT_URL,
              apiKey: openaiKey,
              model: process.env.OPENAI_ASSISTANT_MODEL ?? DEFAULT_VISION_MODEL,
            },
            timeoutMs,
          ),
      })
    }
    const { value: rawReply, firstError } = await balanceProviders(attempts, {
      totalMs: ASSISTANT_TOTAL_BUDGET_MS,
    })
    if (rawReply === null) throw firstError
    const reply = stripMarkdown(rawReply)
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
