import { describe, it, expect } from 'vitest'
import {
  AI_LABEL_MAX,
  AI_NOTES_MAX,
  ClassificationError,
  PLANT_NAME_MAX,
  normalizeImage,
  parseClassification,
  toDataUrl,
  utf8ByteLength,
} from '@/features/ai/types'

/** A full diagnosis — every field the proxy must return. */
const DIAGNOSIS = {
  label: 'Gray Leaf Spot',
  confidence: 0.87,
  severity: 'medium',
  notes: 'Rectangular lesions on the lower canopy. Scout again in 5 days.',
} as const

/** Merge overrides into the fixture so each test stays one line. */
const diagnosis = (overrides: Record<string, unknown> = {}) => ({ ...DIAGNOSIS, ...overrides })

describe('features/ai/types', () => {
  describe('parseClassification', () => {
    it('accepts a full diagnosis', () => {
      expect(parseClassification(DIAGNOSIS)).toEqual(DIAGNOSIS)
    })

    it('keeps plant identity names when the model returns them', () => {
      const parsed = parseClassification(diagnosis({ commonName: '  Maize  ', botanicalName: ' Zea mays ' }))
      expect(parsed.commonName).toBe('Maize')
      expect(parsed.botanicalName).toBe('Zea mays')
    })

    it('keeps the causal agent name and drops it when the finding is abiotic', () => {
      const infected = parseClassification(diagnosis({ pathogenName: ' Ustilago maydis ' }))
      expect(infected.pathogenName).toBe('Ustilago maydis')

      // Drought Stress names no agent — the model answers "" and the field
      // stays absent instead of rendering an empty italic line.
      const abiotic = parseClassification(diagnosis({ label: 'Drought Stress', pathogenName: '' }))
      expect(abiotic.pathogenName).toBeUndefined()
      expect(abiotic.label).toBe('Drought Stress')
    })

    it('omits unusable plant names instead of failing the verdict', () => {
      // Empty / whitespace / non-text / over-cap names are display-only —
      // the diagnosis the farmer waits on must still land.
      const parsed = parseClassification(diagnosis({ commonName: '   ', botanicalName: 42 }))
      expect(parsed.commonName).toBeUndefined()
      expect(parsed.botanicalName).toBeUndefined()
      expect(parsed.label).toBe(DIAGNOSIS.label)

      const tooLong = parseClassification(diagnosis({ commonName: 'x'.repeat(PLANT_NAME_MAX + 1) }))
      expect(tooLong.commonName).toBeUndefined()
    })

    it('trims surrounding whitespace from the label and notes', () => {
      const parsed = parseClassification(diagnosis({ label: '  Leaf Rust  ', notes: '  Mild pustules.  ' }))
      expect(parsed.label).toBe('Leaf Rust')
      expect(parsed.notes).toBe('Mild pustules.')
    })

    it('accepts every severity in the app vocabulary', () => {
      for (const severity of ['high', 'medium', 'low', 'none'] as const) {
        expect(parseClassification(diagnosis({ severity })).severity).toBe(severity)
      }
    })

    it('accepts confidence at both bounds', () => {
      expect(parseClassification(diagnosis({ confidence: 0 })).confidence).toBe(0)
      expect(parseClassification(diagnosis({ confidence: 1 })).confidence).toBe(1)
    })

    it('accepts a label of exactly the on-chain maximum', () => {
      expect(parseClassification(diagnosis({ label: 'A'.repeat(AI_LABEL_MAX) })).label).toHaveLength(AI_LABEL_MAX)
    })

    it('rejects a label longer than the on-chain maximum', () => {
      expect(() => parseClassification(diagnosis({ label: 'A'.repeat(AI_LABEL_MAX + 1) }))).toThrow(ClassificationError)
    })

    it('counts UTF-8 bytes, not characters, against the on-chain maximum', () => {
      // 17 two-byte characters: legal by length (17 ≤ 32), over the byte cap (34 > 32).
      const wideLabel = 'ß'.repeat(17)
      expect(wideLabel.length).toBeLessThanOrEqual(AI_LABEL_MAX)
      expect(utf8ByteLength(wideLabel)).toBeGreaterThan(AI_LABEL_MAX)
      expect(() => parseClassification(diagnosis({ label: wideLabel }))).toThrow(/32 bytes/)
      expect(utf8ByteLength('é中')).toBe(5)
    })

    it('rejects an empty or whitespace-only label', () => {
      expect(() => parseClassification(diagnosis({ label: '' }))).toThrow(/empty label/)
      expect(() => parseClassification(diagnosis({ label: '   ' }))).toThrow(/empty label/)
    })

    it('rejects a non-numeric confidence', () => {
      expect(() => parseClassification(diagnosis({ confidence: '0.5' }))).toThrow(/confidence/)
      expect(() => parseClassification(diagnosis({ confidence: Number.NaN }))).toThrow(/confidence/)
    })

    it('rejects confidence outside [0, 1]', () => {
      expect(() => parseClassification(diagnosis({ confidence: 1.2 }))).toThrow(/range/)
      expect(() => parseClassification(diagnosis({ confidence: -0.1 }))).toThrow(/range/)
    })

    it('rejects a severity outside the app vocabulary', () => {
      expect(() => parseClassification(diagnosis({ severity: 'critical' }))).toThrow(/severity/)
      expect(() => parseClassification(diagnosis({ severity: 'clear' }))).toThrow(/severity/)
      expect(() => parseClassification(diagnosis({ severity: 'HIGH' }))).toThrow(/severity/)
      expect(() => parseClassification(diagnosis({ severity: undefined }))).toThrow(/severity/)
    })

    it('rejects missing or empty notes', () => {
      expect(() => parseClassification(diagnosis({ notes: '' }))).toThrow(/notes/)
      expect(() => parseClassification(diagnosis({ notes: '   ' }))).toThrow(/notes/)
      expect(() => parseClassification({ label: 'Rust', confidence: 0.5, severity: 'low' })).toThrow(/notes/)
    })

    it('rejects notes longer than the schema cap', () => {
      expect(() => parseClassification(diagnosis({ notes: 'n'.repeat(AI_NOTES_MAX + 1) }))).toThrow(
        new RegExp(`${AI_NOTES_MAX} characters`),
      )
    })

    it('rejects non-object payloads', () => {
      expect(() => parseClassification(null)).toThrow(/non-object/)
      expect(() => parseClassification('ok')).toThrow(/non-object/)
      expect(() => parseClassification([1, 2])).toThrow(/non-object/)
    })
  })

  describe('normalizeImage / toDataUrl', () => {
    it('leaves bare base64 untouched and uses the default mime', () => {
      expect(normalizeImage('abc123')).toEqual({ base64: 'abc123', mimeType: 'image/jpeg' })
    })

    it('strips a data URL prefix and recovers its mime type', () => {
      expect(normalizeImage('data:image/png;base64,abc123')).toEqual({ base64: 'abc123', mimeType: 'image/png' })
    })

    it('prefers an explicit mime type over the data URL prefix', () => {
      expect(normalizeImage('data:image/png;base64,abc123', 'image/heic').mimeType).toBe('image/heic')
    })

    it('builds an OpenAI-compatible data URL', () => {
      expect(toDataUrl('abc123', 'image/png')).toBe('data:image/png;base64,abc123')
    })
  })
})
