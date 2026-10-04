/**
 * api/classify-gemini.ts — serverless classification proxy (Google Gemini)
 *
 * The Gemini counterpart of `api/classify.ts`: same app-facing contract
 * (`POST { imageBase64, mimeType }` → `{ label, confidence, severity, notes }`),
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
 *   { "imageBase64": "<base64 bytes>", "mimeType": "image/jpeg" }
 *   → 200 { "label": "Gray Leaf Spot", "confidence": 0.87,
 *           "severity": "medium", "notes": "Lesions on lower canopy …" }
 *
 * Env:
 *   GEMINI_API_KEY — required (create at aistudio.google.com)
 *   GEMINI_MODEL   — optional, defaults to gemini-3.5-flash-lite
 *
 * Run locally with `npm run api:dev` (no Vercel CLI needed) or `vercel dev`.
 */

import { ClassificationError, DEFAULT_MIME_TYPE } from '@/features/ai/types'
import { DEFAULT_GEMINI_MODEL, classifyWithGemini } from './_lib/gemini'
import { MAX_IMAGE_CHARS, parseBody, statusFor, type ProxyRequest, type ProxyResponse } from './_lib/proxy'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body)
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : DEFAULT_MIME_TYPE

  if (imageBase64.trim().length === 0) {
    res.status(400).json({ error: 'imageBase64 is required' })
    return
  }
  if (imageBase64.length > MAX_IMAGE_CHARS) {
    res.status(413).json({ error: 'Image too large' })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY missing' })
    return
  }

  try {
    const result = await classifyWithGemini(imageBase64, mimeType, {
      apiKey,
      model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
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
