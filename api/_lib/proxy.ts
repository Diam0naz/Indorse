/**
 * api/_lib/proxy.ts — shared plumbing for the classification routes
 *
 * Both proxy handlers (`classify.ts` for OpenAI, `classify-gemini.ts` for
 * Gemini) answer the same app-facing contract, so the method/body/size edge
 * and the `ClassificationError` → HTTP status mapping live here once.
 * Underscore-prefixed directories are not treated as routes by Vercel.
 */

import { ClassificationError } from '@/features/ai/types'

/** ~6 MB decoded image ceiling, generous for a phone photo while bounding cost. */
export const MAX_IMAGE_CHARS = 8 * 1024 * 1024

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
