import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailApiError, requestEmailCode, verifyEmailCode } from './emailApi'

const ORIGIN = 'https://api.example.test'
const WALLET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

function stubFetch(ok: boolean, status: number, body: unknown) {
  const mock = vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => vi.unstubAllGlobals())

describe('requestEmailCode', () => {
  it('POSTs the email and wallet to /api/email/start', async () => {
    const mock = stubFetch(true, 200, { sent: true, expiresAt: 1 })
    await requestEmailCode('grower@example.com', WALLET, { origin: ORIGIN })

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/api/email/start`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'grower@example.com', wallet: WALLET })
  })

  it('surfaces the server error and code', async () => {
    stubFetch(false, 429, { error: 'Too many attempts. Request a new code.', code: 'locked' })
    await expect(requestEmailCode('a@b.com', WALLET, { origin: ORIGIN })).rejects.toMatchObject({
      name: 'EmailApiError',
      message: 'Too many attempts. Request a new code.',
      code: 'locked',
    })
  })

  it('fails closed when no origin is configured', async () => {
    await expect(requestEmailCode('a@b.com', WALLET, { origin: '' })).rejects.toBeInstanceOf(EmailApiError)
  })
})

describe('verifyEmailCode', () => {
  it('returns the verdict and any attestation', async () => {
    stubFetch(true, 200, { verified: true, address: WALLET, attestation: { address: 'att', signature: 'sig' } })
    const result = await verifyEmailCode('a@b.com', WALLET, '123456', { origin: ORIGIN })

    expect(result).toEqual({ verified: true, attestation: { address: 'att', signature: 'sig' } })
  })

  it('rejects an invalid code', async () => {
    stubFetch(false, 400, { error: 'That code is not valid.', code: 'mismatch' })
    await expect(verifyEmailCode('a@b.com', WALLET, '000000', { origin: ORIGIN })).rejects.toMatchObject({
      code: 'mismatch',
    })
  })
})
