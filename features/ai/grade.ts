/**
 * features/ai/grade.ts — on-device harvest grading client
 *
 * The app-side counterpart of `api/grade.ts`: the harvest modal POSTs the
 * batch record and receives the dual-model assessment (Gemini + Groq) that
 * rides on-chain with the batch — `grade`, `gradeConfidence`, `gradeNotes`
 * and `gradeFlags` (bit 0 = needs a human verifier) on
 * `submit_harvest_batch`.
 *
 * The proxy owns both model keys; the app never sees them. Failure is a
 * first-class outcome, not an exception path: the caller catches
 * `ClassificationError` and submits the batch UNgraded (grade 0) with a
 * visible note — a field app must not block a harvest because a free-tier
 * model was offline.
 *
 *   const grade = await gradeHarvest(
 *     { crop: 'maize', quantityKg: 640, notes: '…', scoutReports: 6, verifiedReports: 5 },
 *     { endpoint: getGradeEndpoint()! },
 *   )
 */

import { ClassificationError } from './types'

/** What the app sends — the batch record, no photos (this flow has none). */
export interface GradeRequest {
  crop: string
  quantityKg: number
  notes?: string
  scoutReports?: number
  verifiedReports?: number
}

export type GradeAgreement = 'agree' | 'disagree' | 'single'

/** The combined assessment returned by `/api/grade`. */
export interface GradeResult {
  /** On-chain value: 1–4 (A–D). */
  grade: number
  /** Letter for display: 'A'–'D'. */
  gradeLabel: string
  /** Combined confidence, [0, 1]. */
  confidence: number
  /** Primary model's why — ≤64 UTF-8 bytes, the on-chain cap. */
  notes: string
  agreement: GradeAgreement
  /** True when the models disagreed (or both were unsure) — flag bit 0. */
  needsReview: boolean
  /** Which providers actually answered, e.g. ["gemini","groq"]. */
  providers: string[]
}

export interface GradeHarvestOptions {
  /** Full URL of the grading proxy, e.g. `http://…/api/grade`. */
  endpoint: string
  /** Injectable fetch for tests / custom transports. */
  fetchImpl?: typeof fetch
  /** Abort after this many milliseconds. Default 45s (two models reason). */
  timeoutMs?: number
  /** Caller-owned abort signal (e.g. a cancelled modal). */
  signal?: AbortSignal
}

const DEFAULT_GRADE_TIMEOUT_MS = 45_000

/**
 * Read the grading URL from Expo's public env. `null` when unset so the
 * caller can submit ungraded instead of making a bad request.
 */
export function getGradeEndpoint(): string | null {
  const url = process.env.EXPO_PUBLIC_AI_GRADE_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

/** Grade a harvest batch through the dual-model proxy. */
export async function gradeHarvest(request: GradeRequest, options: GradeHarvestOptions): Promise<GradeResult> {
  const { endpoint, fetchImpl = fetch, timeoutMs = DEFAULT_GRADE_TIMEOUT_MS, signal } = options

  if (!endpoint) {
    throw new ClassificationError('bad-request', 'gradeHarvest requires a proxy endpoint')
  }
  if (!request.crop || request.crop.trim().length === 0) {
    throw new ClassificationError('bad-request', 'gradeHarvest requires a crop')
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
      body: JSON.stringify({
        crop: request.crop.trim(),
        quantityKg: request.quantityKg,
        notes: request.notes ?? '',
        scoutReports: request.scoutReports ?? 0,
        verifiedReports: request.verifiedReports ?? 0,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : 'upstream'
      throw new ClassificationError(code, `Grader responded with ${response.status}`, response.status)
    }

    return parseGradeResult(await response.json())
  } catch (error) {
    if (error instanceof ClassificationError) throw error
    if (isAbortError(error)) {
      throw new ClassificationError(
        timedOut ? 'timeout' : 'network',
        timedOut ? `Grader timed out after ${timeoutMs}ms` : 'Grading request was cancelled',
      )
    }
    throw new ClassificationError('network', error instanceof Error ? error.message : 'Grading request failed')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Narrow the proxy payload into a validated `GradeResult` — mirrors the
 * server's contract so a drifting upstream never writes bad bytes on-chain.
 */
export function parseGradeResult(raw: unknown): GradeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ClassificationError('malformed', 'Grader returned a non-object payload')
  }
  const { grade, gradeLabel, confidence, notes, agreement, needsReview, providers } = raw as Record<string, unknown>

  if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 1 || grade > 4) {
    throw new ClassificationError('malformed', 'Grader returned an invalid grade (expected 1–4)')
  }
  if (typeof gradeLabel !== 'string' || !['A', 'B', 'C', 'D'].includes(gradeLabel)) {
    throw new ClassificationError('malformed', 'Grader returned an invalid gradeLabel (expected A–D)')
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ClassificationError('malformed', 'Grader confidence is outside the [0, 1] range')
  }
  if (typeof notes !== 'string') {
    throw new ClassificationError('malformed', 'Grader returned non-text notes')
  }
  if (agreement !== 'agree' && agreement !== 'disagree' && agreement !== 'single') {
    throw new ClassificationError('malformed', 'Grader returned an unknown agreement state')
  }
  if (typeof needsReview !== 'boolean') {
    throw new ClassificationError('malformed', 'Grader returned a non-boolean needsReview')
  }
  if (!Array.isArray(providers) || providers.some((provider) => typeof provider !== 'string')) {
    throw new ClassificationError('malformed', 'Grader returned an invalid providers list')
  }

  return { grade, gradeLabel, confidence, notes, agreement, needsReview, providers: providers as string[] }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
