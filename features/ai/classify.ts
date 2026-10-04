/**
 * features/ai/classify.ts — on-device classification client
 *
 * Standalone POC: takes a base64 field photo, POSTs it to the serverless
 * proxy (`api/classify.ts`) and returns the typed `{ label, confidence,
 * severity, notes }` verdict. The proxy owns the vision-model API key; the
 * app never sees it.
 *
 * This is deliberately transport-only. Wiring the result into
 * `submit_scout_report` (`aiLabel`) happens later, once the native camera /
 * location modules are rebuilt and the program is deployed.
 *
 *   const { label, confidence, severity, notes } = await classifyPhoto(
 *     { imageBase64: await capturePhoto() },
 *     { endpoint: getClassifyEndpoint()! },
 *   )
 */

import {
  ClassificationError,
  DEFAULT_MIME_TYPE,
  parseClassification,
  type ClassificationResult,
  type ClassifyPhotoInput,
} from './types'

export interface ClassifyPhotoOptions {
  /** Full URL of the classification proxy, e.g. `https://…/api/classify`. */
  endpoint: string
  /** Injectable fetch for tests / custom transports. */
  fetchImpl?: typeof fetch
  /** Abort the request after this many milliseconds. Default 15s. */
  timeoutMs?: number
  /** Caller-owned abort signal (e.g. a cancelled capture). */
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Read the proxy URL from Expo's public env. Returns `null` when unset so the
 * caller can surface a clear "not configured" state instead of a bad request.
 */
export function getClassifyEndpoint(): string | null {
  const url = process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

/** Classify a field photo through the proxy. */
export async function classifyPhoto(
  input: ClassifyPhotoInput,
  options: ClassifyPhotoOptions,
): Promise<ClassificationResult> {
  const { endpoint, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options

  if (!input.imageBase64 || input.imageBase64.trim().length === 0) {
    throw new ClassificationError('bad-request', 'classifyPhoto requires imageBase64 bytes')
  }
  if (!endpoint) {
    throw new ClassificationError('bad-request', 'classifyPhoto requires a proxy endpoint')
  }

  // A single controller covers both the caller's signal and our own timeout.
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
      body: JSON.stringify({
        imageBase64: input.imageBase64,
        mimeType: input.mimeType ?? DEFAULT_MIME_TYPE,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : 'upstream'
      throw new ClassificationError(code, `Classifier responded with ${response.status}`, response.status)
    }

    return parseClassification(await response.json())
  } catch (error) {
    if (error instanceof ClassificationError) throw error
    if (isAbortError(error)) {
      throw new ClassificationError(
        timedOut ? 'timeout' : 'network',
        timedOut ? `Classifier timed out after ${timeoutMs}ms` : 'Classification request was cancelled',
      )
    }
    throw new ClassificationError('network', error instanceof Error ? error.message : 'Classification request failed')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
