/**
 * features/ai/types.ts — AI photo-classification contract
 *
 * The classification proxy answers with one `{ label, confidence, severity,
 * notes }` verdict. These types are shared by the on-device client
 * (`classify.ts`) and the serverless proxy (`api/classify.ts`), so the wire
 * format has exactly one definition.
 *
 * `label` is eventually written to `aiLabel` in `submit_scout_report`, a fixed
 * 32-*byte* on-chain field. That limit is enforced here, at the edge — in
 * characters and in UTF-8 bytes — so a long or non-ASCII model label can never
 * fail late at transaction time. `severity` reuses the event union from
 * `constants/data.ts` on purpose: no mapping sits between the model and the
 * pill that renders it.
 */

/** Maximum `label` length — mirrors the on-chain `aiLabel` field. */
export const AI_LABEL_MAX = 32

/** Maximum `notes` length — the same cap the model schema is held to. */
export const AI_NOTES_MAX = 200

/**
 * Severity of a diagnosis. Identical to the event union in `constants/data.ts`
 * and to `sevFor()` in `constants/theme.ts`, so a model verdict drops straight
 * into `SeverityPill`, the CSV export and the log without any mapping.
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
}

export interface ClassifyPhotoInput {
  /** Base64-encoded image bytes (a `data:` prefix is tolerated and stripped). */
  imageBase64: string
  /** Image MIME type. Defaults to `image/jpeg`. */
  mimeType?: string
}

export type ClassificationErrorCode = 'bad-request' | 'unauthorized' | 'upstream' | 'network' | 'timeout' | 'malformed'

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
 * Throws `ClassificationError('malformed')` when the shape is wrong —
 * every rule here mirrors a rule the model schema is also held to, so the
 * edge stays authoritative even if the upstream contract drifts.
 */
export function parseClassification(raw: unknown): ClassificationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ClassificationError('malformed', 'Classifier returned a non-object payload')
  }

  const { label, confidence, severity, notes } = raw as Record<string, unknown>

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

  return { label: trimmed, confidence, severity, notes: trimmedNotes }
}

function isSeverity(value: unknown): value is Severity {
  return SEVERITIES.includes(value as Severity)
}
