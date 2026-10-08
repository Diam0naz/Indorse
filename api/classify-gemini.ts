/**
 * api/classify-gemini.ts — serverless classification proxy (Google Gemini)
 *
 * The Gemini counterpart of `api/classify.ts`: same app-facing contract
 * (`POST { images: [{ imageBase64, mimeType? }, …] }` → one
 * `{ label, confidence, severity, notes }` verdict weighing every shot;
 * legacy single-shot `{ imageBase64, mimeType }` bodies still work),
 * same validation edge and status mapping (`_lib/proxy.ts`), different
 * provider (`_lib/gemini.ts`). The key is a Google AI Studio key and never
 * ships to the client.
 *
 * Deliberately a separate route instead of a provider switch inside
 * `classify.ts`: choosing a backend is then a one-line
 * `EXPO_PUBLIC_AI_CLASSIFY_URL` change on the app side, and each route stays
 * independently testable and redeployable.
 *
 *   POST /api/classify-gemini
 *   { "images": [{ "imageBase64": "<base64 bytes>", "mimeType": "image/jpeg" }] }
 *   → 200 { "label": "Gray Leaf Spot", "confidence": 0.87,
 *           "severity": "medium", "notes": "Lesions on lower canopy …" }
 *
 * Env:
 *   GEMINI_API_KEY  — primary provider
 *   OPENAI_API_KEY  — failover provider (a quota wall, outage or dead key on
 *                     one side answers from the other; only a client fault
 *                     fails fast)
 *   GEMINI_MODEL    — optional, defaults to gemini-3.5-flash-lite
 *
 * Run locally with `npm run api:dev` (no Vercel CLI needed) or `vercel dev`.
 */

import { ClassificationError } from './_lib/ai-types'
import { balanceProviders, type ProviderAttempt } from './_lib/balance'
import { DEFAULT_GEMINI_MODEL, classifyWithGemini } from './_lib/gemini'
import { DEFAULT_VISION_MODEL, classifyWithOpenAI } from './_lib/openai'
import { MAX_IMAGES, collectImages, parseBody, statusFor, type ProxyRequest, type ProxyResponse } from './_lib/proxy'

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

  const geminiKey = process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!geminiKey && !openaiKey) {
    // No provider at all keeps the original misconfigured contract.
    res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY missing' })
    return
  }

  // Ordered failover, mirrored from classify.ts: Gemini answers when healthy,
  // OpenAI takes over on provider-side failures, and a total outage reports
  // the primary's error unchanged (see _lib/balance.ts).
  const attempts: ProviderAttempt<unknown>[] = []
  if (geminiKey) {
    attempts.push({
      name: 'gemini',
      run: () =>
        classifyWithGemini(images, {
          apiKey: geminiKey,
          model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
        }),
    })
  }
  if (openaiKey) {
    attempts.push({
      name: 'openai',
      run: () =>
        classifyWithOpenAI(images, {
          apiKey: openaiKey,
          model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL,
        }),
    })
  }

  try {
    const { value, firstError } = await balanceProviders(attempts)
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
