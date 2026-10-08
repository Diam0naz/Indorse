import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import handler from '@/api/grade'
import {
  GRADE_NOTES_MAX_BYTES,
  GRADE_REVIEW_THRESHOLD,
  combineGrades,
  gradeUserMessage,
  parseGrade,
  validateGradeInput,
  type ResolvedGrade,
} from '@/api/_lib/grade'
import { ClassificationError } from '@/api/_lib/ai-types'

/**
 * The grade route's provider edge: Gemini rides the real `h2Fetch`
 * transport (mocked `node:http2`, same trick as classify-gemini.test.ts)
 * and Groq rides the global fetch (stubbed per test).
 */
const h2 = vi.hoisted(() => {
  const state = {
    status: 200,
    body: '{}',
    connects: [] as string[],
    requests: [] as Array<{ headers: Record<string, string | number>; body: string }>,
  }
  const client = {
    on: () => client,
    close: () => {},
    destroy: () => {},
    request(headers: Record<string, string | number>) {
      const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
      const fire = (event: string, ...args: unknown[]) => {
        for (const callback of handlers[event] ?? []) callback(...args)
      }
      return {
        on(event: string, callback: (...args: unknown[]) => void) {
          ;(handlers[event] ||= []).push(callback)
          return this
        },
        setEncoding: () => {},
        end(body: string) {
          state.requests.push({ headers, body })
          queueMicrotask(() => {
            fire('response', { ':status': state.status })
            if (state.body) fire('data', state.body)
            fire('end')
          })
        },
      }
    },
  }
  const connect = (authority: string) => {
    state.connects.push(authority)
    return client
  }
  return { state, connect }
})

vi.mock('node:http2', () => ({ connect: h2.connect }))

function mockRes() {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.payload = body
      return res
    },
  }
  return res
}

const VALID_BODY = {
  crop: 'maize',
  quantityKg: 640,
  notes: 'Firm cobs, harvested after light rain',
  scoutReports: 6,
  verifiedReports: 5,
}

function geminiVerdict(grade: string, confidence: number, notes: string) {
  return JSON.stringify({ grade, confidence, notes })
}

function groqReply(grade: string, confidence: number, notes: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ grade, confidence, notes }) } }],
    }),
  } as Response
}

const goodFetch = () => vi.fn().mockResolvedValue(groqReply('B', 0.86, 'Sound cobs, minor tip damage'))

describe('grade lib — parseGrade', () => {
  it('accepts letters in any case and maps A=1 … D=4', () => {
    expect(parseGrade({ grade: 'a', confidence: 0.9, notes: 'Clean' })).toMatchObject({ grade: 'A', gradeValue: 1 })
    expect(parseGrade({ grade: 'C', confidence: 0.5, notes: 'Uneven cobs' })).toMatchObject({
      grade: 'C',
      gradeValue: 3,
    })
    expect(parseGrade({ grade: 'D', confidence: 0.2, notes: 'Rot present' })).toMatchObject({
      grade: 'D',
      gradeValue: 4,
    })
  })

  it('normalizes a 0–100 confidence to the [0, 1] range', () => {
    expect(parseGrade({ grade: 'A', confidence: 92, notes: 'Premium' }).confidence).toBeCloseTo(0.92)
    expect(parseGrade({ grade: 'A', confidence: 100, notes: 'Premium' }).confidence).toBe(1)
  })

  it('rejects unknown grades, out-of-range confidence and over-long notes', () => {
    expect(() => parseGrade({ grade: 'A+', confidence: 0.9, notes: 'ok' })).toThrow(ClassificationError)
    expect(() => parseGrade({ grade: 'A', confidence: 1.4, notes: 'ok' })).toThrow(ClassificationError)
    expect(() => parseGrade({ grade: 'A', confidence: 0.9, notes: 'x'.repeat(GRADE_NOTES_MAX_BYTES + 1) })).toThrow(
      ClassificationError,
    )
    expect(() => parseGrade({ grade: 'A', confidence: 0.9, notes: '' })).toThrow(ClassificationError)
  })
})

describe('grade lib — combineGrades', () => {
  const a: ResolvedGrade = { grade: 'A', gradeValue: 1, confidence: 0.9, notes: 'Clean, uniform' }
  const b: ResolvedGrade = { grade: 'B', gradeValue: 2, confidence: 0.7, notes: 'Minor tip damage' }

  it('agreement averages confidence and does not flag', () => {
    const result = combineGrades(a, { ...a, confidence: 0.8 }, ['gemini', 'groq'])
    expect(result.agreement).toBe('agree')
    expect(result.confidence).toBeCloseTo(0.85)
    expect(result.needsReview).toBe(false)
    expect(result.grade).toBe(1)
  })

  it('agreement below the threshold still flags a human', () => {
    const low: ResolvedGrade = { grade: 'B', gradeValue: 2, confidence: 0.4, notes: 'Thin record' }
    const result = combineGrades(low, { ...low, confidence: 0.3 }, ['gemini', 'groq'])
    expect(result.agreement).toBe('agree')
    expect(result.confidence).toBeCloseTo(0.35)
    expect(result.needsReview).toBe(true)
  })

  it('disagreement keeps the stronger grade but takes the minimum confidence and flags', () => {
    const result = combineGrades(a, b, ['gemini', 'groq'])
    expect(result.agreement).toBe('disagree')
    expect(result.gradeLabel).toBe('A')
    expect(result.confidence).toBeCloseTo(0.7)
    expect(result.needsReview).toBe(true)
  })

  it('a single verdict reports single, passes on high confidence, flags below threshold', () => {
    const high = combineGrades(a, null, ['gemini'])
    expect(high.agreement).toBe('single')
    expect(high.providers).toEqual(['gemini'])
    expect(high.needsReview).toBe(false)
    expect(GRADE_REVIEW_THRESHOLD).toBe(0.5)

    const low = combineGrades({ ...b, confidence: 0.4 }, null, ['groq'])
    expect(low.providers).toEqual(['groq'])
    expect(low.needsReview).toBe(true)
  })
})

describe('grade lib — input validation', () => {
  it('accepts a valid body and fills optional fields with zeros', () => {
    const result = validateGradeInput({ crop: 'maize', quantityKg: 640 })
    expect(result).toEqual({
      ok: true,
      input: { crop: 'maize', quantityKg: 640, notes: '', scoutReports: 0, verifiedReports: 0 },
    })
  })

  it('rejects missing crop, non-positive quantity and bad counters', () => {
    expect(validateGradeInput({ quantityKg: 1 })).toMatchObject({ ok: false })
    expect(validateGradeInput({ crop: 'maize', quantityKg: 0 })).toMatchObject({ ok: false })
    expect(validateGradeInput({ crop: 'maize', quantityKg: 1, scoutReports: -2 })).toMatchObject({ ok: false })
    expect(validateGradeInput({ crop: 'maize', quantityKg: 1, scoutReports: 1.5 })).toMatchObject({ ok: false })
  })

  it('builds a user message carrying the provenance evidence', () => {
    const message = gradeUserMessage({ crop: 'maize', quantityKg: 640, notes: '', scoutReports: 6, verifiedReports: 5 })
    expect(message).toContain('Crop: maize')
    expect(message).toContain('(none)')
    expect(message).toContain('6 report(s)')
    expect(message).toContain('5 verified')
  })
})

describe('grade route', () => {
  beforeEach(() => {
    h2.state.status = 200
    h2.state.body = '{}'
    h2.state.requests.length = 0
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.GROQ_API_KEY = 'test-groq-key'
    vi.stubGlobal('fetch', goodFetch())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GEMINI_API_KEY
    delete process.env.GROQ_API_KEY
  })

  it('405s non-POST methods', async () => {
    const res = mockRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('400s an invalid body', async () => {
    const res = mockRes()
    await handler({ body: { quantityKg: -1 } }, res)
    expect(res.statusCode).toBe(400)
  })

  it('500s when neither provider key is configured', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GROQ_API_KEY
    const res = mockRes()
    await handler({ body: VALID_BODY }, res)
    expect(res.statusCode).toBe(500)
  })

  it('answers an agreeing assessment from both providers', async () => {
    h2.state.body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: geminiVerdict('B', 0.9, 'Firm cobs, even color') }] } }],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqReply('B', 0.8, 'Firm cobs, minor tip wear')))

    const res = mockRes()
    await handler({ body: VALID_BODY }, res)

    expect(res.statusCode).toBe(200)
    const body = res.payload as Record<string, unknown>
    expect(body.grade).toBe(2)
    expect(body.gradeLabel).toBe('B')
    expect(body.confidence).toBeCloseTo(0.85)
    expect(body.agreement).toBe('agree')
    expect(body.needsReview).toBe(false)
    expect(body.providers).toEqual(['gemini', 'groq'])
    expect(h2.state.requests).toHaveLength(1)
    expect(h2.state.requests[0].headers['x-goog-api-key']).toBe('test-gemini-key')
  })

  it('flags a disagreement for human review and keeps the stronger grade', async () => {
    h2.state.body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: geminiVerdict('A', 0.88, 'Premium appearance') }] } }],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqReply('C', 0.6, 'Uneven sizing, some scarring')))

    const res = mockRes()
    await handler({ body: VALID_BODY }, res)

    expect(res.statusCode).toBe(200)
    const body = res.payload as Record<string, unknown>
    expect(body.gradeLabel).toBe('A')
    expect(body.agreement).toBe('disagree')
    expect(body.needsReview).toBe(true)
    expect(body.confidence).toBeCloseTo(0.6)
  })

  it('degrades to a single honest verdict when one provider fails', async () => {
    h2.state.status = 502
    h2.state.body = '{"error":"upstream"}'

    const res = mockRes()
    await handler({ body: VALID_BODY }, res)

    expect(res.statusCode).toBe(200)
    const body = res.payload as Record<string, unknown>
    expect(body.providers).toEqual(['groq'])
    expect(body.agreement).toBe('single')
    expect(body.secondary).toBeNull()
    expect(body.grade).toBe(2)
  })

  it('502s when both providers fail', async () => {
    h2.state.status = 503
    h2.state.body = '{"error":"capacity"}'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as Response))

    const res = mockRes()
    await handler({ body: VALID_BODY }, res)

    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'upstream' })
  })
})
