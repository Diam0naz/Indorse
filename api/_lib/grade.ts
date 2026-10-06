/**
 * api/_lib/grade.ts — harvest grading core for the dual-model trust layer
 *
 * The advisor's "AI drives the money movement" piece: when a farmer submits a
 * harvest batch, two independent free-tier models grade it (`Gemini vision
 * family for text here, Groq gpt-oss for the second opinion`), the verdicts
 * are compared, and the result rides on-chain with the batch so a buyer sees
 * "Grade A · 92% · models agree" before locking USDC.
 *
 * Design rules, kept in one place so the trust story stays honest:
 *
 *   - Letters on the wire, numbers on chain. Models grade "A"–"D" (unambiguous
 *     in a prompt); `parseGrade` maps A=1 … D=4 for `HarvestBatch::grade`.
 *   - Evidence-limited grading. The harvest record is metadata (crop,
 *     quantity, farmer notes, scouting counts) — no produce photo exists in
 *     this flow, so the prompt orders a lower confidence when the record
 *     cannot distinguish grades, never an invented one.
 *   - Agreement raises confidence, disagreement flags a human. Two verdicts
 *     with the same letter average their confidences; different letters keep
 *     the higher-confidence grade but take the MINIMUM confidence and set
 *     `needsReview` (grade_flags bit 0). A lone verdict flags itself below
 *     0.5. Nothing here can silently inflate trust.
 *   - Notes are bounded at the edge: ≤64 UTF-8 bytes, the exact on-chain cap,
 *     so a long model reply can never fail late at transaction time.
 *
 * Provider calls take an injectable `fetchImpl` so tests run without keys.
 */

import { ClassificationError, utf8ByteLength } from '@/features/ai/types'
import { GEMINI_BASE_URL, extractText, h2Fetch, sendWithRetry, toGeminiSchema, GEMINI_RETRY_DELAY_MS } from './gemini'

/** The four market grades, best to worst. */
export const GRADE_LETTERS = ['A', 'B', 'C', 'D'] as const
export type GradeLetter = (typeof GRADE_LETTERS)[number]

/** On-chain `HarvestBatch::grade` values — A=1 … D=4, 0 means ungraded. */
export const GRADE_VALUE: Record<GradeLetter, number> = { A: 1, B: 2, C: 3, D: 4 }

/** Grade notes on chain are a `String<64>` — the same cap the edge enforces. */
export const GRADE_NOTES_MAX_BYTES = 64

/** Confidence below this after combination is flagged for a human verifier. */
export const GRADE_REVIEW_THRESHOLD = 0.5

/** Groq free-tier ceiling for one grading call. */
export const GROQ_TIMEOUT_MS = 30_000

/** Default second-opinion model — the strongest free text model on the key. */
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * The shared grading prompt. One prompt, two providers — the verdict means
 * the same thing whichever model produced it, so comparing them is fair.
 */
export const GRADE_PROMPT = [
  'You are a harvest quality grader for a smallholder-farm provenance app.',
  "Given one submitted harvest batch (crop, quantity, the farmer's own notes, and the farm's scouting record),",
  'assign a market quality grade and return the structured verdict.',
  'Grades (only these four):',
  '- "A" — premium: clean, uniform size and color, no damage, rot or mold; fresh-market quality.',
  '- "B" — good: minor cosmetic issues but sound overall, no rot.',
  '- "C" — fair: visible defects, uneven quality or short shelf life; suited to processing.',
  '- "D" — poor: rot, damage or contamination; not fit for fresh sale.',
  'Rules:',
  '- Grade ONLY from the evidence in the batch record. There is no produce photo.',
  '  When the record cannot distinguish between grades, return a LOWER "confidence" instead of guessing.',
  '- "confidence" is an honest probability between 0 and 1: above 0.85 only for strong consistent evidence,',
  '  0.5–0.7 for plausible but partial evidence, below 0.4 when the record is thin. Never inflate it.',
  '- "notes" is at most 60 characters of plain ASCII saying WHY this grade, for example',
  '  "Firm cobs, even color, no rot". No product names, no prices, no promises about sales or payouts.',
  '- Return only the JSON object; no prose, no markdown.',
].join('\n')

/**
 * Shared verdict schema (OpenAI-compatible lowercase dialect — Gemini's
 * projection lives in `toGeminiSchema`, so both providers answer one shape).
 */
export const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    grade: {
      type: 'string',
      enum: [...GRADE_LETTERS],
      description: 'Market quality grade: A (best) through D (worst).',
    },
    confidence: {
      type: 'number',
      description: 'Honest calibrated probability between 0 and 1.',
    },
    notes: {
      type: 'string',
      description: 'At most 60 characters of plain ASCII explaining the grade.',
    },
  },
  required: ['grade', 'confidence', 'notes'],
  additionalProperties: false,
} as const

/** One provider's validated verdict. */
export interface ResolvedGrade {
  grade: GradeLetter
  /** The value stored in `HarvestBatch::grade` (A=1 … D=4). */
  gradeValue: number
  confidence: number
  notes: string
}

/** What the models are asked to grade. */
export interface GradeInput {
  crop: string
  quantityKg: number
  notes: string
  scoutReports: number
  verifiedReports: number
}

export type GradeAgreement = 'agree' | 'disagree' | 'single'

/** The combined assessment the app puts on the chain and shows buyers. */
export interface GradeAssessment {
  grade: number
  gradeLabel: GradeLetter
  confidence: number
  notes: string
  agreement: GradeAgreement
  needsReview: boolean
  providers: string[]
  primary: ResolvedGrade
  secondary: ResolvedGrade | null
}

/** Build the user message from the batch record. */
export function gradeUserMessage(input: GradeInput): string {
  return [
    `Crop: ${input.crop}`,
    `Quantity: ${input.quantityKg} kg`,
    `Farmer's notes: ${input.notes.trim().length > 0 ? input.notes.trim() : '(none)'}`,
    `Scouting record: ${input.scoutReports} report(s) this season, ${input.verifiedReports} verified by an agronomist.`,
  ].join('\n')
}

/**
 * Narrow an unknown provider payload into a validated verdict.
 * Accepts a 0–100 confidence (some models answer "92" for 0.92) and
 * normalizes it; everything else is strict so the edge stays authoritative.
 */
export function parseGrade(raw: unknown): ResolvedGrade {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ClassificationError('malformed', 'Grader returned a non-object payload')
  }
  const { grade, confidence, notes } = raw as Record<string, unknown>

  const letter = typeof grade === 'string' ? grade.trim().toUpperCase() : ''
  if (!GRADE_LETTERS.includes(letter as GradeLetter)) {
    throw new ClassificationError('malformed', 'Grader returned an unknown grade (expected A, B, C or D)')
  }

  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    throw new ClassificationError('malformed', 'Grader returned a non-numeric confidence')
  }
  // Accept "92" for 0.92 — but only a plausible percentage: values in
  // (1, 10) can't be a percentage and can't be a fraction, so they fail here.
  let normalized = confidence
  if (confidence > 1) {
    if (confidence >= 10 && confidence <= 100) normalized = confidence / 100
    else throw new ClassificationError('malformed', 'Grader confidence is outside the [0, 1] range')
  }
  if (normalized < 0 || normalized > 1) {
    throw new ClassificationError('malformed', 'Grader confidence is outside the [0, 1] range')
  }

  if (typeof notes !== 'string' || notes.trim().length === 0) {
    throw new ClassificationError('malformed', 'Grader returned empty notes')
  }
  const trimmed = notes.trim()
  if (utf8ByteLength(trimmed) > GRADE_NOTES_MAX_BYTES) {
    throw new ClassificationError('malformed', `Grader notes exceed ${GRADE_NOTES_MAX_BYTES} bytes`)
  }

  const resolved = letter as GradeLetter
  return { grade: resolved, gradeValue: GRADE_VALUE[resolved], confidence: normalized, notes: trimmed }
}

/**
 * Combine one or two verdicts into the assessment written on-chain.
 *
 *   agree    — same letter: average the confidences (agreement can raise,
 *              never above 1); still flag below the review threshold.
 *   disagree — keep the higher-confidence grade, take the MINIMUM
 *              confidence, and always flag for a human verifier.
 *   single   — one provider answered (or the other failed): honest
 *              `agreement: "single"`, flag below the threshold.
 *
 * `providers` names the models that actually answered, in call order.
 */
export function combineGrades(
  primary: ResolvedGrade,
  secondary: ResolvedGrade | null,
  providers: string[],
): GradeAssessment {
  if (!secondary) {
    return {
      grade: primary.gradeValue,
      gradeLabel: primary.grade,
      confidence: primary.confidence,
      notes: primary.notes,
      agreement: 'single',
      needsReview: primary.confidence < GRADE_REVIEW_THRESHOLD,
      providers,
      primary,
      secondary: null,
    }
  }

  const agree = secondary.grade === primary.grade
  const confidence = agree
    ? (primary.confidence + secondary.confidence) / 2
    : Math.min(primary.confidence, secondary.confidence)
  const chosen = agree || primary.confidence >= secondary.confidence ? primary : secondary

  return {
    grade: chosen.gradeValue,
    gradeLabel: chosen.grade,
    confidence,
    notes: chosen.notes,
    agreement: agree ? 'agree' : 'disagree',
    needsReview: !agree || confidence < GRADE_REVIEW_THRESHOLD,
    providers,
    primary,
    secondary,
  }
}

/** Validate the request body once, for the route's 400 edge. */
export type GradeInputValidation = { ok: true; input: GradeInput } | { ok: false; error: string }

export function validateGradeInput(body: Record<string, unknown>): GradeInputValidation {
  const { crop, quantityKg, notes, scoutReports, verifiedReports } = body

  if (typeof crop !== 'string' || crop.trim().length === 0) return { ok: false, error: 'crop is required' }
  if (crop.trim().length > 32) return { ok: false, error: 'crop must be at most 32 characters' }
  if (typeof quantityKg !== 'number' || !Number.isFinite(quantityKg) || quantityKg <= 0) {
    return { ok: false, error: 'quantityKg must be a positive number' }
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 256)) {
    return { ok: false, error: 'notes must be a string of at most 256 characters' }
  }
  for (const field of ['scoutReports', 'verifiedReports'] as const) {
    const value = body[field]
    if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
      return { ok: false, error: `${field} must be a non-negative integer` }
    }
  }

  return {
    ok: true,
    input: {
      crop: crop.trim(),
      quantityKg,
      notes: typeof notes === 'string' ? notes : '',
      scoutReports: typeof scoutReports === 'number' ? scoutReports : 0,
      verifiedReports: typeof verifiedReports === 'number' ? verifiedReports : 0,
    },
  }
}

export interface GradeProviderDeps {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
}

/**
 * First opinion: Gemini's text family over the proven `h2Fetch` transport
 * (same retry/timeout edge as the vision classifier).
 */
export async function gradeWithGemini(input: GradeInput, deps: GradeProviderDeps): Promise<ResolvedGrade> {
  if (!deps.apiKey) {
    throw new ClassificationError('unauthorized', 'GEMINI_API_KEY is not configured')
  }
  const fetchImpl = deps.fetchImpl ?? h2Fetch
  const model = deps.model ?? 'gemini-3.5-flash-lite'

  const response = await sendWithRetry(
    () =>
      fetchImpl(`${GEMINI_BASE_URL}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: GRADE_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: gradeUserMessage(input) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(GRADE_SCHEMA),
            temperature: 0.2,
          },
        }),
      }),
    deps.fetchImpl ? 0 : GEMINI_RETRY_DELAY_MS,
  )

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream'
    throw new ClassificationError(code, `Gemini responded with ${response.status}`, response.status)
  }

  const payload: unknown = await response.json()
  const { text, blocked } = extractText(payload)
  if (blocked) throw new ClassificationError('malformed', `Gemini refused to grade this batch (${blocked})`)
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new ClassificationError('malformed', 'Gemini returned no grade text')

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new ClassificationError('malformed', 'Gemini returned non-JSON content')
  }
  return parseGrade(parsed)
}

/**
 * Second opinion: Groq's free gpt-oss-120b over the OpenAI-compatible chat
 * endpoint with JSON mode. It is text-only on this key (no vision models in
 * the catalog), which fits — the harvest record has no photo to look at.
 */
export async function gradeWithGroq(input: GradeInput, deps: GradeProviderDeps): Promise<ResolvedGrade> {
  if (!deps.apiKey) {
    throw new ClassificationError('unauthorized', 'GROQ_API_KEY is not configured')
  }
  const fetchImpl = deps.fetchImpl ?? fetch
  const model = deps.model ?? DEFAULT_GROQ_MODEL

  let response: Response
  try {
    response = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: GRADE_PROMPT },
          { role: 'user', content: gradeUserMessage(input) },
        ],
        temperature: 0.2,
        // gpt-oss reasons before answering; give it headroom or the JSON
        // arrives truncated and parseGrade rejects it as malformed.
        max_completion_tokens: 4000,
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ClassificationError(
      timedOut ? 'timeout' : 'network',
      timedOut ? `Groq request timed out after ${GROQ_TIMEOUT_MS}ms` : 'Groq request failed',
    )
  }

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream'
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
    throw new ClassificationError('malformed', 'Groq returned no grade content')
  }

  // JSON mode should not fence, but tolerate a stray ```json wrapper.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new ClassificationError('malformed', 'Groq returned non-JSON content')
  }
  return parseGrade(parsed)
}
