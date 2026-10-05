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
 *   OPENAI_API_KEY      — required
 *   OPENAI_VISION_MODEL — optional, defaults to gpt-6-astra
 *
 * Run locally with `npm run api:dev` (no Vercel CLI needed) or `vercel dev`.
 */

import { ClassificationError } from '@/features/ai/types'
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

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: OPENAI_API_KEY missing' })
    return
  }

  try {
    const result = await classifyWithOpenAI(images, {
      apiKey,
      model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL,
    })
    res.status(200).json(result)
  } catch (error) {
    if (error instanceof ClassificationError) {
      res.status(statusFor(error)).json({ error: error.message, code: error.code })
      return
    }
    res.status(500).json({ error: 'Classification failed' })
  }
}
