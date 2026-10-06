import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import handler, {
  MAX_MESSAGE_CHARS,
  RATE_LIMIT,
  resetAssistantRateLimit,
  sanitizeContext,
  stripMarkdown,
} from '@/api/assistant'
import { KNOWLEDGE_DOC, buildAssistantSystem, contextBlock } from '@/api/_lib/knowledge'

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

const REPLY = 'La puntuación de procedencia es verificados dividido entre total.'

function groqOk(reply: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: reply } }] }),
  } as Response)
}

describe('knowledge doc', () => {
  it('only documents what is actually mounted — no unmounted features', () => {
    // The doc is the model's whole world: naming something that does not
    // exist would make the assistant confidently lie to a farmer.
    expect(KNOWLEDGE_DOC).not.toContain('api/weather')
    expect(KNOWLEDGE_DOC).toContain('No forecasts and no weather API')
    expect(KNOWLEDGE_DOC).toContain('/api/grade')
    expect(KNOWLEDGE_DOC).toContain('Ustilago maydis')
    expect(KNOWLEDGE_DOC).toContain('does NOT have')
  })

  it('never asks for secrets and always states the no-transaction rule', () => {
    const system = buildAssistantSystem({ lang: 'en' })
    expect(system).toContain('never build, sign or send a transaction')
    expect(system).toContain('say you do not know')
    expect(system).toContain('Reply in English')
    // Replies land in plain RN <Text> — markdown would render as asterisks.
    expect(system).toContain('Plain text only')
  })

  it('states the payout direction — a mechanic the model must never invert', () => {
    // The live model once guessed "rainfall must EXCEED the trigger" when
    // the doc was silent; the program pays strictly BELOW it. Lock both the
    // headline rule and the precise settle rule.
    expect(KNOWLEDGE_DOC).toContain('BELOW the trigger the policy pays out')
    expect(KNOWLEDGE_DOC).toContain('strictly below the trigger pays the cover')
    expect(KNOWLEDGE_DOC).toContain('at or above it pays nothing')
  })

  it('spells out the reward mechanic — no per-farm bounty, no verifier-gated release', () => {
    // The live model once answered "how do I set up a scouting bounty?" with a
    // confident, coherent and entirely fabricated design: owner-set rewards held
    // in per-farm escrow and released by a verifier. Each assertion below is
    // checkable against programs/indorse_program/.../lib.rs: REPORT_REWARD is a
    // single const, reward_vault is one shared account, the RewardReport accounts
    // struct has no Signer, and its only gate is report.status == Verified.
    expect(KNOWLEDGE_DOC).toContain('There is no bounty system')
    expect(KNOWLEDGE_DOC).toContain('ONE fixed constant')
    expect(KNOWLEDGE_DOC).toContain('ONE shared reward vault')
    expect(KNOWLEDGE_DOC).toContain('Verifiers never approve, release or block a payment')
    expect(KNOWLEDGE_DOC).toContain('no signer gate')
    // Negative knowledge, not mere omission: the doc has to contradict the
    // pattern the model would otherwise borrow from other Web3 apps.
    expect(KNOWLEDGE_DOC).toContain('No per-farm or owner-set bounties, no staking')
    expect(KNOWLEDGE_DOC).toContain('there are no reward terms to set')
  })

  it('never routes a user to a surface that does not exist', () => {
    // The app has no help pages, privacy policy or support channel anywhere in
    // the tree — a fallback naming one would itself be an invention.
    expect(KNOWLEDGE_DOC).toContain('No in-app help pages, no privacy policy')
    expect(KNOWLEDGE_DOC).not.toContain('in-app docs')
    expect(KNOWLEDGE_DOC).not.toContain('asking a human')
    expect(KNOWLEDGE_DOC).not.toContain('privacy policy or ask')
    const system = buildAssistantSystem({ lang: 'en' })
    expect(system).toContain('Never fill a gap')
    expect(system).toContain('unless this document says so in those words')
  })

  it('states that on-chain GPS is public instead of leaving privacy to the model', () => {
    // "Stored on-chain" without "publicly readable" invites a reassuring
    // privacy claim the model cannot support.
    expect(KNOWLEDGE_DOC).toContain('latitude and')
    expect(KNOWLEDGE_DOC).toContain('On-chain accounts are public')
    expect(KNOWLEDGE_DOC).toContain('This document says nothing about selling, sharing or profiling')
  })

  it('personalizes from context and omits absent fields', () => {
    const withState = contextBlock(
      {
        route: '/(tabs)/reports',
        walletConnected: true,
        hasFarm: true,
        farmName: 'Blue Berry Farms',
        policy: { status: 'active', triggerMm: 120, totalMm: 85 },
      },
      'en',
    )
    expect(withState).toContain('/(tabs)/reports')
    expect(withState).toContain('Blue Berry Farms')
    expect(withState).toContain('trigger 120 mm')
    expect(withState).toContain('rainfall so far 85 mm')

    expect(contextBlock({}, 'en')).toBe('')
    // Strings are clipped, never passed through raw.
    expect(contextBlock({ farmName: 'x'.repeat(100) }, 'en')).toContain('x'.repeat(48))
  })
})

describe('sanitizeContext', () => {
  it('keeps only allowlisted, typed, capped fields', () => {
    const clean = sanitizeContext({
      route: '/(tabs)/farms',
      walletConnected: false,
      hasFarm: true,
      farmName: 'Riverbend',
      policy: { status: 'active', triggerMm: 120, totalMm: -5, bogus: 'drop me' },
      email: 'farmer@example.com',
      keys: ['seed', 'phrase'],
    })
    expect(clean).toEqual({
      route: '/(tabs)/farms',
      walletConnected: false,
      hasFarm: true,
      farmName: 'Riverbend',
      policy: { status: 'active', triggerMm: 120 },
    })
    expect(sanitizeContext(null)).toBeUndefined()
    expect(sanitizeContext('nope')).toBeUndefined()
    expect(sanitizeContext({})).toBeUndefined()
  })
})

describe('assistant route', () => {
  beforeEach(() => {
    resetAssistantRateLimit()
    process.env.GROQ_API_KEY = 'test-key'
    delete process.env.GROQ_MODEL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GROQ_API_KEY
  })

  it('405s non-POST methods', async () => {
    const res = mockRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('400s an empty or oversized question', async () => {
    const empty = mockRes()
    await handler({ body: { message: '   ' } }, empty)
    expect(empty.statusCode).toBe(400)

    const huge = mockRes()
    await handler({ body: { message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) } }, huge)
    expect(huge.statusCode).toBe(400)
  })

  it('500s when the model key is missing', async () => {
    delete process.env.GROQ_API_KEY
    const res = mockRes()
    await handler({ body: { message: 'hi' } }, res)
    expect(res.statusCode).toBe(500)
  })

  it('answers with grounded context in the requested language', async () => {
    const fetchMock = groqOk(REPLY)
    vi.stubGlobal('fetch', fetchMock)

    const res = mockRes()
    await handler(
      {
        ip: '10.0.0.1',
        body: {
          message: '¿Qué significa la puntuación de procedencia?',
          lang: 'es',
          context: { route: '/(tabs)/farms', hasFarm: true, farmName: 'Blue Berry Farms' },
        },
      },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ reply: REPLY, lang: 'es' })

    const init = fetchMock.mock.calls[0][1] as { body: string }
    const sent = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> }
    const system = sent.messages[0]
    expect(system.role).toBe('system')
    expect(sent.messages[1].content).toBe('¿Qué significa la puntuación de procedencia?')
    // The system prompt carries the knowledge, the language and this farm.
    expect(system.content).toContain('Blue Berry Farms')
    expect(system.content).toContain('Reply in Spanish (español)')
    expect(system.content).toContain(KNOWLEDGE_DOC.slice(0, 60))
  })

  it('asks the model at temperature 0 — rewording is drift, not variety', async () => {
    // A guide bot gains nothing from creative variation: every rewording is one
    // more chance to wander off the knowledge doc. Zero also makes the manual
    // trap-question eval reproducible run to run.
    const fetchMock = groqOk(REPLY)
    vi.stubGlobal('fetch', fetchMock)
    const res = mockRes()
    await handler({ body: { message: 'who pays the reward?' } }, res)
    expect(res.statusCode).toBe(200)

    const init = fetchMock.mock.calls[0][1] as { body: string }
    const sent = JSON.parse(init.body) as { temperature?: number }
    expect(sent.temperature).toBe(0)
  })

  it('strips markdown so asterisks never reach the screen', async () => {
    // Unit: emphasis, code, headers — list dashes survive (plain "- " is fine).
    expect(stripMarkdown('Rainfall is **below** the trigger.')).toBe('Rainfall is below the trigger.')
    expect(stripMarkdown('call `fetch` with *care*')).toBe('call fetch with care')
    expect(stripMarkdown('## Watch the season\n- one\n- two')).toBe('Watch the season\n- one\n- two')

    // End to end: whatever the model writes arrives clean.
    vi.stubGlobal('fetch', groqOk('The reading of **85 mm** sits `_below_` 120 mm.'))
    const res = mockRes()
    await handler({ body: { message: 'will I get paid?' } }, res)
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ reply: 'The reading of 85 mm sits _below_ 120 mm.', lang: 'en' })
  })

  it('502s honestly when the model call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response))
    const res = mockRes()
    await handler({ body: { message: 'what is escrow?' } }, res)
    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'upstream' })
  })

  it('passes an upstream 429 through as 429, not as a generic failure', async () => {
    // Groq's own quota wall is a rate limit. Returning 502 here would show
    // "try again" and send the farmer straight back into it; 429 lets the
    // sheet show its wait-a-minute note.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as Response))
    const res = mockRes()
    await handler({ ip: '10.0.0.21', body: { message: 'who pays the reward?' } }, res)
    expect(res.statusCode).toBe(429)
    expect(res.payload).toMatchObject({ code: 'upstream' })
  })

  it('rate-limits a client that burns through the budget', async () => {
    vi.stubGlobal('fetch', groqOk(REPLY))
    for (let i = 0; i < RATE_LIMIT.max; i += 1) {
      const ok = mockRes()
      await handler({ ip: '10.0.0.9', body: { message: `question ${i}` } }, ok)
      expect(ok.statusCode).toBe(200)
    }
    const blocked = mockRes()
    await handler({ ip: '10.0.0.9', body: { message: 'one more' } }, blocked)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.payload).toMatchObject({ code: 'rate-limited' })

    // A different client still has budget — the limit is per IP.
    const other = mockRes()
    await handler({ ip: '10.0.0.10', body: { message: 'hello' } }, other)
    expect(other.statusCode).toBe(200)
  })
})
