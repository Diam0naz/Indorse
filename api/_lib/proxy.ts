/**
 * api/_lib/proxy.ts — shared plumbing for the classification routes
 *
 * Both proxy handlers (`classify.ts` for OpenAI, `classify-gemini.ts` for
 * Gemini) answer the same app-facing contract, so the method/body/size edge
 * and the `ClassificationError` → HTTP status mapping live here once.
 * Underscore-prefixed directories are not treated as routes by Vercel.
 */

import { ClassificationError, DEFAULT_MIME_TYPE } from '@/features/ai/types'

/** ~6 MB decoded image ceiling, generous for a phone photo while bounding cost. */
export const MAX_IMAGE_CHARS = 8 * 1024 * 1024

/** Hard ceiling on photos per call — mirrors the app's 5-shot report. */
export const MAX_IMAGES = 5

/** One validated image, ready for a provider helper. */
export interface ProxyImage {
  imageBase64: string
  mimeType: string
}

export interface CollectedImages {
  images: ProxyImage[]
  /** Nothing usable arrived — answer 400. */
  missing: boolean
  /** At least one entry exceeds MAX_IMAGE_CHARS — answer 413. */
  tooLarge: boolean
  /** More than MAX_IMAGES entries — answer 400 (cost bound). */
  tooMany: boolean
}

/**
 * Pull the image list out of either accepted contract shape:
 *
 *   { images: [{ imageBase64, mimeType? }, …] }   multi-shot reports
 *   { imageBase64, mimeType? }                    legacy single-shot body
 *
 * Blank or malformed entries are dropped; `missing` means nothing usable
 * remained. Validation for size and count lives here so both route handlers
 * share exactly one edge.
 */
export function collectImages(body: Record<string, unknown>): CollectedImages {
  const images: ProxyImage[] = []

  if (Array.isArray(body.images)) {
    for (const entry of body.images) {
      if (!entry || typeof entry !== 'object') continue
      const { imageBase64, mimeType } = entry as Record<string, unknown>
      if (typeof imageBase64 !== 'string' || imageBase64.trim().length === 0) continue
      images.push({
        imageBase64,
        mimeType: typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : DEFAULT_MIME_TYPE,
      })
    }
  } else if (typeof body.imageBase64 === 'string' && body.imageBase64.trim().length > 0) {
    const mimeType = typeof body.mimeType === 'string' && body.mimeType.length > 0 ? body.mimeType : DEFAULT_MIME_TYPE
    images.push({ imageBase64: body.imageBase64, mimeType })
  }

  return {
    images,
    missing: images.length === 0,
    tooLarge: images.some((image) => image.imageBase64.length > MAX_IMAGE_CHARS),
    tooMany: images.length > MAX_IMAGES,
  }
}

/** Minimal structural types so the handlers need no `@vercel/node` dependency. */
export interface ProxyRequest {
  method?: string
  body?: unknown
}

export interface ProxyResponse {
  status(code: number): ProxyResponse
  json(body: unknown): void
}

export function statusFor(error: ClassificationError): number {
  switch (error.code) {
    case 'bad-request':
      return 400
    case 'unauthorized':
      return 401
    case 'timeout':
      return 504
    default:
      return 502
  }
}

/** Vercel parses JSON bodies, but tolerate a raw string for other hosts/tests. */
export function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}
