/**
 * api/classify.ts — serverless classification proxy
 *
 * The one place the vision-model API key lives. The mobile app POSTs a photo
 * and receives one complete `{ label, confidence, severity, notes }` verdict;
 * the key is never shipped to the client. The model call itself is streamed
 * and schema-constrained upstream (`_lib/openai.ts`), but the proxy collapses
 * that stream into a single JSON body for the app.
 *
 *   POST /api/classify
 *   { "images": [{ "imageBase64": "<base64 bytes>", "mimeType": "image/jpeg" }, …] }
 *   (legacy single-shot `{ imageBase64, mimeType }` bodies still work)
 *   → 200 { "label": "Gray Leaf Spot", "confidence": 0.87,
 *           "severity": "medium", "notes": "Lesions on lower canopy …" }
 *
 * Env:
 *   OPENAI_API_KEY      — primary provider
 *   GEMINI_API_KEY      — failover provider (a quota wall, outage or dead key
 *                          on one side answers from the other; only a client
 *                          fault fails fast)
 *   OPENAI_VISION_MODEL — optional, defaults to gpt-6-astra
 *   GEMINI_MODEL        — optional, defaults to gemini-3.5-flash-lite
 *
 * Run locally with `npm run api:dev` (no Vercel CLI needed) or `vercel dev`.
 */

import { ClassificationError } from './_lib/ai-types'
import { balanceProviders, type ProviderAttempt } from './_lib/balance'
import { DEFAULT_GEMINI_MODEL, classifyWithGemini } from './_lib/gemini'
import { DEFAULT_VISION_MODEL, OPENAI_TIMEOUT_MS, classifyWithOpenAI } from './_lib/openai'
import {
  CLASSIFY_TOTAL_BUDGET_MS,
  MAX_IMAGES,
  collectImages,
  parseBody,
  statusFor,
  type ProxyRequest,
  type ProxyResponse,
} from './_lib/proxy'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body)
  const { images, missing, tooLarge, tooMany } = collectImages(body)

  if (missing) {
    res.status(400).json({ error: 'images[] requires at least one imageBase64 entry' })
    return
  }
  if (tooLarge) {
    res.status(413).json({ error: 'Image too large' })
    return
  }
  if (tooMany) {
    res.status(400).json({ error: `At most ${MAX_IMAGES} images per request` })
    return
  }

  const openaiKey = process.env.OPENAI_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!openaiKey && !geminiKey) {
    // No provider at all keeps the original misconfigured contract.
    res.status(500).json({ error: 'Server misconfigured: OPENAI_API_KEY missing' })
    return
  }

  // Ordered failover: the primary answers when healthy, the secondary takes
  // over on provider-side failures, and a total outage reports the primary's
  // error unchanged. Both share ONE deadline (see _lib/balance.ts): the
  // primary is capped so a stall cannot eat the request, and the fallback
  // spends whatever time is left.
  const attempts: ProviderAttempt<unknown>[] = []
  if (openaiKey) {
    attempts.push({
      name: 'openai',
      budgetMs: OPENAI_TIMEOUT_MS,
      run: (timeoutMs) =>
        classifyWithOpenAI(images, {
          apiKey: openaiKey,
          model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL,
          timeoutMs,
        }),
    })
  }
  if (geminiKey) {
    attempts.push({
      name: 'gemini',
      // No cap: the failover gets whatever the primary left unused.
      run: (timeoutMs) =>
        classifyWithGemini(images, {
          apiKey: geminiKey,
          model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
          timeoutMs,
        }),
    })
  }

  try {
    const { value, firstError } = await balanceProviders(attempts, { totalMs: CLASSIFY_TOTAL_BUDGET_MS })
    if (value === null) throw firstError
    res.status(200).json(value)
  } catch (error) {
    if (error instanceof ClassificationError) {
      res.status(statusFor(error)).json({ error: error.message, code: error.code })
      return
    }
    res.status(500).json({ error: 'Classification failed' })
  }
}
