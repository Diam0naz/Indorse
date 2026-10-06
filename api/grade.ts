/**
 * api/grade.ts — dual-model harvest grading proxy
 *
 * AI in the money flow: the app POSTs the batch record before signing
 * `submit_harvest_batch`, and two independent free-tier models grade it —
 * Gemini (first opinion) and Groq gpt-oss-120b (second opinion). Their
 * verdicts are compared by `_lib/grade.ts`; the app writes the combined
 * result into the batch:
 *
 *   grade           ← 1..4 (A..D), 0 when grading was impossible
 *   grade_confidence← 0..100
 *   grade_notes     ← ≤64 bytes, the primary model's why
 *   grade_flags     ← bit 0 set when the models disagreed (human verifier)
 *
 *   POST /api/grade
 *   { "crop": "maize", "quantityKg": 640, "notes": "…",
 *     "scoutReports": 6, "verifiedReports": 5 }
 *   → 200 { "grade": 2, "gradeLabel": "B", "confidence": 0.91,
 *           "notes": "Firm cobs, even color, no rot",
 *           "agreement": "agree", "needsReview": false,
 *           "providers": ["gemini", "groq"],
 *           "primary": {…}, "secondary": {…} }
 *
 * One provider failing is not an error: the assessment degrades to
 * `agreement: "single"` with an honest `providers` list. Both failing → 502,
 * and the app submits the batch ungraded (0) with a visible note.
 *
 * Env: GEMINI_API_KEY (first opinion), GROQ_API_KEY (second),
 *      GEMINI_MODEL / GROQ_MODEL (optional overrides).
 */

import { ClassificationError, type ClassificationErrorCode } from '@/features/ai/types'
import { DEFAULT_GROQ_MODEL, combineGrades, gradeWithGemini, gradeWithGroq, validateGradeInput } from './_lib/grade'
import { DEFAULT_GEMINI_MODEL } from './_lib/gemini'
import { parseBody, statusFor, type ProxyRequest, type ProxyResponse } from './_lib/proxy'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const validated = validateGradeInput(parseBody(req.body))
  if (!validated.ok) {
    res.status(400).json({ error: validated.error })
    return
  }

  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey = process.env.GROQ_API_KEY
  if (!geminiKey && !groqKey) {
    res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY / GROQ_API_KEY missing' })
    return
  }

  const input = validated.input
  const [first, second] = await Promise.allSettled([
    geminiKey
      ? gradeWithGemini(input, { apiKey: geminiKey, model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL })
      : Promise.reject(new ClassificationError('unauthorized', 'GEMINI_API_KEY is not configured')),
    groqKey
      ? gradeWithGroq(input, { apiKey: groqKey, model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL })
      : Promise.reject(new ClassificationError('unauthorized', 'GROQ_API_KEY is not configured')),
  ])

  const geminiVerdict = first.status === 'fulfilled' ? first.value : null
  const groqVerdict = second.status === 'fulfilled' ? second.value : null
  const providers = [geminiVerdict ? 'gemini' : null, groqVerdict ? 'groq' : null].filter(
    (provider): provider is string => provider !== null,
  )
  const primary = geminiVerdict ?? groqVerdict

  if (!primary) {
    // Both calls rejected — surface the more interesting of the two failures.
    let failure: unknown
    if (first.status === 'rejected') failure = first.reason
    else if (second.status === 'rejected') failure = second.reason
    const code: ClassificationErrorCode = failure instanceof ClassificationError ? failure.code : 'upstream'
    const message = failure instanceof Error ? failure.message : 'Grading failed'
    res.status(statusFor(new ClassificationError(code, message))).json({ error: message, code })
    return
  }

  // A second opinion only exists when the first opinion landed too; with
  // only Groq answering the assessment degrades to `agreement: "single"`.
  const secondary = geminiVerdict ? groqVerdict : null
  const assessment = combineGrades(primary, secondary, providers)

  res.status(200).json({
    grade: assessment.grade,
    gradeLabel: assessment.gradeLabel,
    confidence: assessment.confidence,
    notes: assessment.notes,
    agreement: assessment.agreement,
    needsReview: assessment.needsReview,
    providers: assessment.providers,
    primary: assessment.primary,
    secondary: assessment.secondary,
  })
}
