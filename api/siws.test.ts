import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { getBase58Decoder } from '@solana/kit'
import { createSignInMessageText } from '@solana/wallet-standard-util'
import nonceHandler from '@/api/siws/nonce'
import verifyHandler, { createVerifyHandler } from '@/api/siws/verify'
import type { SgtChecker } from '@/api/_lib/sgt'
import { SiwsNonceStore, type IssuedSiwsPayload } from '@/api/_lib/siws-store'

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

/** Issue a payload through the real nonce route. */
async function issue(overrides: Partial<IssuedSiwsPayload> = {}): Promise<IssuedSiwsPayload> {
  const res = mockRes()
  await nonceHandler({ method: 'POST' }, res)
  expect(res.statusCode).toBe(200)
  return { ...(res.payload as IssuedSiwsPayload), ...overrides }
}

/** A throwaway ed25519 identity, exactly what a wallet would hold. */
function makeSigner() {
  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const address = getBase58Decoder().decode(publicKey)
  return {
    address,
    secretKey,
    /** Produce the `{ address, nonce, signature, signedMessage }` proof. */
    prove(payload: IssuedSiwsPayload) {
      const text = createSignInMessageText({ ...payload, address })
      const signedMessage = new TextEncoder().encode(text)
      const signature = ed25519.sign(signedMessage, secretKey)
      return {
        address,
        nonce: payload.nonce,
        signature: Array.from(signature),
        signedMessage: Array.from(signedMessage),
      }
    },
  }
}

/** Sign `text` with an arbitrary key — for key-binding attacks. */
function signText(text: string, secretKey: Uint8Array): number[] {
  return Array.from(ed25519.sign(new TextEncoder().encode(text), secretKey))
}

async function post(body: unknown) {
  const res = mockRes()
  await verifyHandler({ method: 'POST', body }, res)
  return res
}

describe('POST /api/siws/nonce', () => {
  afterEach(() => {
    delete process.env.SIWS_DOMAIN
    delete process.env.SIWS_URI
  })

  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await nonceHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('issues a complete payload pinned to mainnet', async () => {
    const payload = await issue()

    expect(payload).toMatchObject({
      chainId: 'solana:mainnet',
      domain: expect.any(String),
      expirationTime: expect.any(String),
      issuedAt: expect.any(String),
      statement: expect.any(String),
      uri: expect.any(String),
      version: '1',
    })
    expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(Date.parse(payload.expirationTime)).toBeGreaterThan(Date.parse(payload.issuedAt))
  })

  it('mints a fresh nonce on every call', async () => {
    const first = await issue()
    const second = await issue()
    expect(first.nonce).not.toBe(second.nonce)
  })

  it('binds the payload to SIWS_DOMAIN / SIWS_URI when configured', async () => {
    process.env.SIWS_DOMAIN = 'dev.example.com'
    process.env.SIWS_URI = 'https://dev.example.com/app'

    const payload = await issue()

    expect(payload.domain).toBe('dev.example.com')
    expect(payload.uri).toBe('https://dev.example.com/app')
  })
})

describe('POST /api/siws/verify — input shape', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await verifyHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('requires address and nonce', async () => {
    expect((await post({})).statusCode).toBe(400)
    expect((await post({ address: 'x' })).statusCode).toBe(400)
    expect((await post({ nonce: 'x' })).statusCode).toBe(400)
  })

  it('rejects a malformed address', async () => {
    const issued = await issue()
    const res = await post({ address: 'not-a-key', nonce: issued.nonce, signature: [], signedMessage: [] })
    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ error: 'Malformed address.' })
  })

  it('rejects a malformed signature', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const good = signer.prove(issued)

    expect((await post({ ...good, signature: good.signature.slice(1) })).statusCode).toBe(400) // wrong length
    expect((await post({ ...good, signature: [...good.signature.slice(0, 63), 256] })).statusCode).toBe(400) // out of range
    expect((await post({ ...good, signature: [...good.signature.slice(0, 63), -1] })).statusCode).toBe(400)
  })

  it('rejects a malformed signed message', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const good = signer.prove(issued)

    const res = await post({ ...good, signedMessage: [...good.signedMessage.slice(0, -1), 300] })
    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ error: 'Malformed signed message.' })
  })
})

describe('POST /api/siws/verify — signature checks', () => {
  beforeEach(() => {
    process.env.SGT_DEV_ALLOWLIST = '*'
  })

  afterEach(() => {
    delete process.env.SGT_DEV_ALLOWLIST
  })

  it('accepts a real SIWS proof over the issued payload', async () => {
    const signer = makeSigner()
    const issued = await issue()

    const res = await post(signer.prove(issued))

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: true, address: signer.address, method: 'allowlist' })
  })

  it('rejects an unknown nonce', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const proof = signer.prove(issued)
    proof.nonce = 'deadbeef'.repeat(4) // valid hex, never issued

    const res = await post(proof)
    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'nonce' })
  })

  it('accepts each proof exactly once — a replay fails', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const proof = signer.prove(issued)

    expect((await post(proof)).statusCode).toBe(200)
    expect((await post(proof)).statusCode).toBe(401)
  })

  it('binds the signature to the address — another key cannot sign for it', async () => {
    const alice = makeSigner()
    const mallory = makeSigner()
    const issued = await issue()

    // Mallory signs a perfectly valid message… naming Alice's address.
    const text = createSignInMessageText({ ...issued, address: alice.address })
    const res = await post({
      address: alice.address,
      nonce: issued.nonce,
      signature: signText(text, mallory.secretKey),
      signedMessage: Array.from(new TextEncoder().encode(text)),
    })

    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'signature' })
  })

  it('verifies against the STORED payload — a tampered statement fails', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const tampered = signer.prove({ ...issued, statement: 'I am the admin' })

    const res = await post(tampered)

    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'signature' })
  })
})

describe('POST /api/siws/verify — allowlist gate', () => {
  afterEach(() => {
    delete process.env.SGT_DEV_ALLOWLIST
  })

  it('passes an address listed in the allowlist (comma-separated, spaces ok)', async () => {
    const signer = makeSigner()
    process.env.SGT_DEV_ALLOWLIST = `somebody-else, ${signer.address} , another`
    const issued = await issue()

    const res = await post(signer.prove(issued))

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: true, address: signer.address, method: 'allowlist' })
  })

  it('fails closed when the allowlist is empty or missing', async () => {
    delete process.env.SGT_DEV_ALLOWLIST
    const signer = makeSigner()
    const issued = await issue()

    const res = await post(signer.prove(issued))

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: false, address: signer.address, reason: 'not-allowlisted' })

    process.env.SGT_DEV_ALLOWLIST = '   '
    const issued2 = await issue()
    expect((await post(signer.prove(issued2))).payload).toMatchObject({ verified: false })
  })

  it('keeps the SGT_DEV_ALLOWLIST wildcard dev-only', async () => {
    process.env.SGT_DEV_ALLOWLIST = '*'
    const signer = makeSigner()
    const issued = await issue()
    expect((await post(signer.prove(issued))).payload).toMatchObject({ verified: true })
  })
})

describe('POST /api/siws/verify — SGT gate (SGT_RPC_URL configured)', () => {
  /** Stand-in mint address echoed in an `sgt` verdict. */
  const SGT_MINT = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'

  beforeEach(() => {
    process.env.SGT_RPC_URL = 'https://mainnet.example.invalid'
    delete process.env.SGT_DEV_ALLOWLIST // allowlist misses → the SGT gate runs
  })

  afterEach(() => {
    delete process.env.SGT_RPC_URL
    delete process.env.SGT_DEV_ALLOWLIST
  })

  async function postWith(checkSgt: SgtChecker, body: unknown) {
    const res = mockRes()
    await createVerifyHandler({ checkSgt })({ method: 'POST', body }, res)
    return res
  }

  it('verifies an allowlist miss through the SGT check', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: true, mintAddress: SGT_MINT }))

    const res = await postWith(checkSgt, signer.prove(issued))

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: true, address: signer.address, method: 'sgt', mintAddress: SGT_MINT })
    expect(checkSgt).toHaveBeenCalledWith(signer.address)
  })

  it('denies with reason no-sgt when the wallet holds no SGT', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: false, mintAddress: null }))

    const res = await postWith(checkSgt, signer.prove(issued))

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ verified: false, address: signer.address, reason: 'no-sgt' })
  })

  it('never consults the SGT check for an allowlisted address', async () => {
    const signer = makeSigner()
    process.env.SGT_DEV_ALLOWLIST = signer.address
    const issued = await issue()
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: false, mintAddress: null }))

    const res = await postWith(checkSgt, signer.prove(issued))

    expect(res.payload).toEqual({ verified: true, address: signer.address, method: 'allowlist' })
    expect(checkSgt).not.toHaveBeenCalled()
  })

  it('answers 503 when the mainnet check fails — an outage is not "no SGT"', async () => {
    const signer = makeSigner()
    const issued = await issue()
    const checkSgt = vi.fn<SgtChecker>(async () => {
      throw new Error('rpc down')
    })

    const res = await postWith(checkSgt, signer.prove(issued))

    expect(res.statusCode).toBe(503)
    expect(res.payload).toEqual({ error: 'Verification temporarily unavailable.' })
    expect(res.payload).not.toHaveProperty('verified')
  })

  it('keeps the legacy deny when SGT verification is not configured', async () => {
    delete process.env.SGT_RPC_URL
    const signer = makeSigner()
    const issued = await issue()
    const checkSgt = vi.fn<SgtChecker>(async () => ({ hasSGT: true, mintAddress: SGT_MINT }))

    const res = await postWith(checkSgt, signer.prove(issued))

    expect(res.payload).toEqual({ verified: false, address: signer.address, reason: 'not-allowlisted' })
    expect(checkSgt).not.toHaveBeenCalled()
  })
})

describe('SiwsNonceStore', () => {
  it('consumes a nonce exactly once', () => {
    const store = new SiwsNonceStore(1_000, () => 0)
    const payload = {
      nonce: 'abc',
      domain: 'd',
      uri: 'u',
      chainId: 'c',
      statement: 's',
      version: '1',
      issuedAt: 'i',
      expirationTime: 'e',
    }

    store.issue(payload)
    expect(store.consume('abc')).toEqual(payload)
    expect(store.consume('abc')).toBeNull()
  })

  it('expires a nonce after the TTL', () => {
    let now = 0
    const store = new SiwsNonceStore(1_000, () => now)
    const payload = {
      nonce: 'abc',
      domain: 'd',
      uri: 'u',
      chainId: 'c',
      statement: 's',
      version: '1',
      issuedAt: 'i',
      expirationTime: 'e',
    }

    store.issue(payload)
    now = 1_000
    expect(store.consume('abc')).toBeNull()
  })

  it('sweeps expired entries when issuing', () => {
    let now = 0
    const store = new SiwsNonceStore(1_000, () => now)
    store.issue({
      nonce: 'old',
      domain: 'd',
      uri: 'u',
      chainId: 'c',
      statement: 's',
      version: '1',
      issuedAt: 'i',
      expirationTime: 'e',
    })
    now = 2_000
    store.issue({
      nonce: 'new',
      domain: 'd',
      uri: 'u',
      chainId: 'c',
      statement: 's',
      version: '1',
      issuedAt: 'i',
      expirationTime: 'e',
    })

    expect(store.consume('old')).toBeNull() // long gone — no leak
    expect(store.consume('new')).not.toBeNull()
  })
})
