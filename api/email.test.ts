import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import startHandler from '@/api/email/start'
import verifyHandler from '@/api/email/verify'
import { RESEND_ENDPOINT } from '@/api/_lib/email'
import { EmailOtpStore, emailOtpStore, normalizeEmail, otpKey } from '@/api/_lib/otp-store'
import { darkTokens } from '@/constants/theme'

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
    },
  }
  return res
}

/** A real 32-byte address (the SPL Token program) — decodes to 32 bytes. */
const WALLET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const EMAIL = 'grower@example.com'
const API_KEY = 're_test_key'

/** Capture the outbound provider call so the emailed code can be read back. */
let sent: { url: string; init: RequestInit } | null = null

function stubFetch(ok = true, status = 200, body: unknown = { id: 'email-1' }) {
  sent = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, init }
      return { ok, status, json: async () => body } as unknown as Response
    }),
  )
}

function lastEmail() {
  return JSON.parse(sent!.init.body as string) as {
    from: string
    to: string
    subject: string
    text: string
    html?: string
  }
}

function codeFromLastEmail(): string {
  const match = lastEmail().text.match(/\b(\d{6})\b/)
  if (!match) throw new Error('no code found in the sent email')
  return match[1]
}

async function start(email = EMAIL, wallet = WALLET) {
  const res = mockRes()
  await startHandler({ method: 'POST', body: { email, wallet } }, res)
  return res
}

async function verify(code: string, email = EMAIL, wallet = WALLET) {
  const res = mockRes()
  await verifyHandler({ method: 'POST', body: { email, wallet, code } }, res)
  return res
}

beforeEach(() => {
  process.env.RESEND_API_KEY = API_KEY
  delete process.env.EMAIL_FROM
  emailOtpStore.clear()
})

afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
  emailOtpStore.clear()
  vi.unstubAllGlobals()
})

describe('EmailOtpStore', () => {
  it('issues a code that verifies exactly once', () => {
    const store = new EmailOtpStore()
    store.issue('k', '123456')

    expect(store.verify('k', '123456')).toBe('ok')
    expect(store.verify('k', '123456')).toBe('missing')
  })

  it('rejects a wrong code and counts the attempt down', () => {
    const store = new EmailOtpStore()
    store.issue('k', '123456')

    expect(store.verify('k', '000000')).toBe('mismatch')
    expect(store.verify('k', '123456')).toBe('ok')
  })

  it('locks the key once the attempt budget is spent', () => {
    const store = new EmailOtpStore(600_000, 2)
    store.issue('k', '123456')

    expect(store.verify('k', '000000')).toBe('mismatch')
    expect(store.verify('k', '000001')).toBe('locked')
    // Locked: even the right code no longer works.
    expect(store.verify('k', '123456')).toBe('missing')
  })

  it('expires a code after its TTL', () => {
    let now = 1_000
    const store = new EmailOtpStore(600_000, 5, () => now)
    store.issue('k', '123456')

    now += 600_001
    expect(store.verify('k', '123456')).toBe('expired')
  })

  it('keys case-insensitively on the email', () => {
    expect(normalizeEmail('  Grower@Example.COM ')).toBe('grower@example.com')
  })
})

describe('POST /api/email/start', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await startHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects an invalid email before sending anything', async () => {
    stubFetch()
    const res = await start('not-an-email')
    expect(res.statusCode).toBe(400)
    expect(sent).toBeNull()
  })

  it('rejects a malformed wallet address', async () => {
    stubFetch()
    const res = await start(EMAIL, 'not-a-key')
    expect(res.statusCode).toBe(400)
    expect(sent).toBeNull()
  })

  it('fails closed when the provider key is missing', async () => {
    delete process.env.RESEND_API_KEY
    stubFetch()
    const res = await start()
    expect(res.statusCode).toBe(500)
    expect(sent).toBeNull()
  })

  it('emails a 6-digit code through the provider', async () => {
    stubFetch()
    const res = await start()

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ sent: true, expiresAt: expect.any(Number) })
    expect(sent!.url).toBe(RESEND_ENDPOINT)

    const headers = sent!.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`)

    const email = lastEmail()
    expect(email.to).toBe(EMAIL)
    expect(email.subject).toBe('Your Indorse verification code')
    expect(codeFromLastEmail()).toMatch(/^\d{6}$/)
  })

  it('themes the html body with the app palette', async () => {
    stubFetch()
    const res = await start()
    expect(res.statusCode).toBe(200)

    const html = lastEmail().html ?? ''
    // "Warm Charcoal", exactly as constants/theme.ts declares it — the email
    // mirrors darkTokens server-side, and this is what keeps the mirror true.
    expect(html).toContain(darkTokens.background)
    expect(html).toContain(darkTokens.surface)
    expect(html).toContain(darkTokens.surfaceAlt)
    expect(html).toContain(darkTokens.border)
    expect(html).toContain(darkTokens.primary)
    expect(html).toContain(darkTokens.text)
    expect(html).toContain(darkTokens.textMuted)
    // The code sits in the themed well, and the message stays link-free.
    expect(html).toContain(codeFromLastEmail())
    expect(html).not.toMatch(/href=/i)
  })

  it('maps a provider auth failure to a 502 without leaking internals', async () => {
    stubFetch(false, 401)
    const res = await start()
    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'unauthorized' })
  })
})

describe('POST /api/email/verify', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await verifyHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a malformed code shape', async () => {
    const res = await verify('12')
    expect(res.statusCode).toBe(400)
  })

  it('rejects a code that was never issued', async () => {
    const res = await verify('123456')
    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ code: 'missing' })
  })

  it('verifies the code that was emailed', async () => {
    stubFetch()
    await start()
    const code = codeFromLastEmail()

    const res = await verify(code)
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: true, address: WALLET })
  })

  it('burns the code after a successful verification', async () => {
    stubFetch()
    await start()
    const code = codeFromLastEmail()

    expect((await verify(code)).statusCode).toBe(200)
    expect((await verify(code)).statusCode).toBe(400)
  })

  it('locks after too many wrong attempts', async () => {
    stubFetch()
    await start()
    const key = otpKey(EMAIL, WALLET)

    for (let i = 0; i < 4; i += 1) {
      expect((await verify('000000')).statusCode).toBe(400)
    }
    const locked = await verify('000000')
    expect(locked.statusCode).toBe(429)
    expect(locked.payload).toMatchObject({ code: 'locked' })
    expect(key).toBe('grower@example.com|' + WALLET)
  })
})

describe('passcode-recovery codes (wallet-less)', () => {
  async function startRecovery(email = EMAIL) {
    const res = mockRes()
    await startHandler({ method: 'POST', body: { email } }, res)
    return res
  }

  async function verifyRecovery(code: string, email = EMAIL) {
    const res = mockRes()
    await verifyHandler({ method: 'POST', body: { email, code } }, res)
    return res
  }

  it('sends a code without a wallet (lock-screen recovery)', async () => {
    stubFetch()
    const res = await startRecovery()

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ sent: true, expiresAt: expect.any(Number) })
    expect(lastEmail().to).toBe(EMAIL)
    expect(codeFromLastEmail()).toMatch(/^\d{6}$/)
  })

  it('verifies it with { verified: true } alone — no address, no attestation', async () => {
    stubFetch()
    await startRecovery()

    const res = await verifyRecovery(codeFromLastEmail())
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: true })
  })

  it('keeps the wallet-bound pair on its own key', async () => {
    stubFetch()
    await start() // issued against (email, wallet)

    // The same code, replayed without the wallet, must find nothing.
    const res = await verifyRecovery(codeFromLastEmail())
    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ code: 'missing' })
  })

  it('still refuses a malformed wallet when one is sent', async () => {
    stubFetch()
    const res = mockRes()
    await startHandler({ method: 'POST', body: { email: EMAIL, wallet: 'not-a-key' } }, res)

    expect(res.statusCode).toBe(400)
    expect(sent).toBeNull()
  })
})
