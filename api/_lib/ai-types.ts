/**
 * api/_lib/ai-types.ts — AI photo-classification types (local copy for Vercel)
 *
 * Copied from features/ai/types.ts so serverless functions don't rely on
 * tsconfig path aliases. Keep in sync when the source changes.
 */

/** Maximum `label` length — mirrors the on-chain `aiLabel` field. */
export const AI_LABEL_MAX = 32

/** Maximum `notes` length — the same cap the model schema is held to. */
export const AI_NOTES_MAX = 200

/** Display-only caps for the plant identity names. */
export const PLANT_NAME_MAX = 64

/**
 * Severity of a diagnosis. Identical to the event union in `constants/data.ts`
 * and to `sevFor()` in `constants/theme.ts`.
 */
export type Severity = 'high' | 'medium' | 'low' | 'none'

export const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low', 'none']

/** Default image MIME type when the caller does not supply one. */
export const DEFAULT_MIME_TYPE = 'image/jpeg'

export interface ClassificationResult {
  /** Short, human-readable diagnosis, e.g. `"Gray Leaf Spot"`. */
  label: string
  /** Model confidence in the [0, 1] range. */
  confidence: number
  /** How bad it is — drives `SeverityPill` and the risk ranking. */
  severity: Severity
  /** 1–2 plain sentences the farmer can act on. */
  notes: string
  /** Plain-English name of the plant shown, e.g. `"Maize"`. */
  commonName?: string
  /** Latin binomial of the plant shown, e.g. `"Zea mays"`. */
  botanicalName?: string
  /** Scientific name of the causal agent, e.g. `"Ustilago maydis"`. */
  pathogenName?: string
}

/** One photo in a (possibly multi-shot) classification call. */
export interface ImageInput {
  /** Base64-encoded image bytes (a `data:` prefix is tolerated and stripped). */
  imageBase64: string
  /** Image MIME type. Defaults to `image/jpeg`. */
  mimeType?: string
}

export interface ClassifyPhotoInput {
  /** Every shot the scout took of the plant — 1..5 photos. */
  images: ImageInput[]
}

/**
 * `payload-too-large` is the host's own body cap (Vercel answers 413 before
 * the handler runs), not a proxy verdict — it has no route-level status
 * mapping because the route never produces it.
 */
export type ClassificationErrorCode =
  'bad-request' | 'payload-too-large' | 'unauthorized' | 'upstream' | 'network' | 'timeout' | 'malformed'

export class ClassificationError extends Error {
  readonly code: ClassificationErrorCode
  readonly status?: number

  constructor(code: ClassificationErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ClassificationError'
    this.code = code
    this.status = status
  }
}

/** Strip an optional `data:<mime>;base64,` prefix from an image payload. */
export function normalizeImage(imageBase64: string, mimeType?: string): { base64: string; mimeType: string } {
  const dataUrl = /^data:([^;,]+)?;base64,(.*)$/s.exec(imageBase64)
  if (dataUrl) {
    return { base64: dataUrl[2], mimeType: mimeType ?? dataUrl[1] ?? DEFAULT_MIME_TYPE }
  }
  return { base64: imageBase64, mimeType: mimeType ?? DEFAULT_MIME_TYPE }
}

/** Build an OpenAI-compatible `data:` URL from base64 image bytes. */
export function toDataUrl(imageBase64: string, mimeType?: string): string {
  const { base64, mimeType: mime } = normalizeImage(imageBase64, mimeType)
  return `data:${mime};base64,${base64}`
}

/** UTF-8 byte length — `aiLabel` is a 32-*byte* on-chain field, not 32 chars. */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/**
 * Narrow an unknown proxy payload into a validated `ClassificationResult`.
 * Throws `ClassificationError('malformed')` when the shape is wrong.
 */
export function parseClassification(raw: unknown): ClassificationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ClassificationError('malformed', 'Classifier returned a non-object payload')
  }

  const { label, confidence, severity, notes, commonName, botanicalName, pathogenName } = raw as Record<string, unknown>

  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new ClassificationError('malformed', 'Classifier returned an empty label')
  }
  const trimmed = label.trim()
  if (trimmed.length > AI_LABEL_MAX) {
    throw new ClassificationError('malformed', `Classifier label exceeds ${AI_LABEL_MAX} characters`)
  }
  if (utf8ByteLength(trimmed) > AI_LABEL_MAX) {
    throw new ClassificationError('malformed', `Classifier label exceeds ${AI_LABEL_MAX} bytes`)
  }

  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    throw new ClassificationError('malformed', 'Classifier returned a non-numeric confidence')
  }
  if (confidence < 0 || confidence > 1) {
    throw new ClassificationError('malformed', 'Classifier confidence is outside the [0, 1] range')
  }

  if (!isSeverity(severity)) {
    throw new ClassificationError(
      'malformed',
      `Classifier returned an unknown severity (expected one of ${SEVERITIES.join(', ')})`,
    )
  }

  if (typeof notes !== 'string' || notes.trim().length === 0) {
    throw new ClassificationError('malformed', 'Classifier returned empty notes')
  }
  const trimmedNotes = notes.trim()
  if (trimmedNotes.length > AI_NOTES_MAX) {
    throw new ClassificationError('malformed', `Classifier notes exceed ${AI_NOTES_MAX} characters`)
  }

  // Identity fields are display-only: a missing, non-text or over-long name
  // is dropped so it can never fail a verdict the farmer is waiting on.
  const common = displayName(commonName)
  const botanical = displayName(botanicalName)
  const pathogen = displayName(pathogenName)

  return {
    label: trimmed,
    confidence,
    severity,
    notes: trimmedNotes,
    ...(common ? { commonName: common } : {}),
    ...(botanical ? { botanicalName: botanical } : {}),
    ...(pathogen ? { pathogenName: pathogen } : {}),
  }
}

/** Lenient optional-name reader for the identity fields — undefined when unusable. */
function displayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > PLANT_NAME_MAX) return undefined
  return trimmed
}

function isSeverity(value: unknown): value is Severity {
  return SEVERITIES.includes(value as Severity)
}
