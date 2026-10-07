/**
 * API admin routes — the two-gate contract:
 *
 *   1. a single-use SIWS proof (shared core with /api/siws/verify)
 *   2. the signer must equal `config.admin`, read from the config PDA
 *
 * The chain read is stubbed through `fetch` (JSON-RPC getAccountInfo → a
 * real encoded Config account), so these tests exercise the actual codec
 * path — not a mocked gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { getBase58Decoder, getBase64Decoder } from '@solana/kit'
import { createSignInMessageText } from '@solana/wallet-standard-util'
import nonceHandler from '@/api/siws/nonce'
import verifyHandler from '@/api/siws/verify'
import statusHandler from '@/api/admin/status'
import allowlistHandler from '@/api/admin/allowlist'
import { clearAdminCache } from '@/api/_lib/admin-auth'
import { resetAllowlist } from '@/api/_lib/allowlist'
import { encodeAccount } from '@/lib/program/codec'
import type { IssuedSiwsPayload } from '@/api/_lib/siws-store'

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
async function issue(): Promise<IssuedSiwsPayload> {
  const res = mockRes()
  await nonceHandler({ method: 'POST' }, res)
  expect(res.statusCode).toBe(200)
  return res.payload as IssuedSiwsPayload
}

/** A throwaway ed25519 identity, exactly what a wallet would hold. */
function makeSigner() {
  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const address = getBase58Decoder().decode(publicKey)
  return {
    address,
    /** Produce the `{ address, nonce, signature, signedMessage }` proof. */
    async prove() {
      const payload = await issue()
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

function freshAddress(): string {
  return getBase58Decoder().decode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))
}

type Handler = (req: { method?: string; body?: unknown }, res: ReturnType<typeof mockRes>) => Promise<void>

async function post(handler: Handler, body: unknown) {
  const res = mockRes()
  await handler({ method: 'POST', body }, res)
  return res
}

const base64 = getBase64Decoder()
const VERIFIER_ROLE = freshAddress()
const ORACLE_ROLE = freshAddress()

/** JSON-RPC account wrapper — the shape `encoding: 'base64'` returns. */
function rpcAccount(bytes: Uint8Array) {
  return {
    data: [base64.decode(bytes), 'base64'],
    executable: false,
    lamports: 2_000_000,
    owner: '11111111111111111111111111111111',
    rentEpoch: 0,
    space: bytes.length,
  }
}

/**
 * Stub `fetch` so the admin gate's `getAccountInfo` answers with a real
 * encoded Config account (or null / an unreachable network).
 */
function stubConfigRpc(config: { admin: string } | null | 'fail') {
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    if (config === 'fail') throw new TypeError('Network unavailable')
    const request = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string }
    const respond = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    if (request.method === 'getAccountInfo') {
      const value = config
        ? rpcAccount(
            encodeAccount('Config', { admin: config.admin, verifier: VERIFIER_ROLE, oracle: ORACLE_ROLE, bump: 255 }),
          )
        : null
      return respond({ context: { slot: 1 }, value })
    }
    return respond(null)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  clearAdminCache()
  resetAllowlist()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAdminCache()
  resetAllowlist()
  delete process.env.SGT_DEV_ALLOWLIST
  delete process.env.OPERATOR_ALLOWLIST
  delete process.env.RESEND_API_KEY
  delete process.env.GEMINI_API_KEY
})

/* ── POST /api/admin/status ──────────────────────────────────────────────── */

describe('POST /api/admin/status', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await statusHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a malformed body before touching the nonce store', async () => {
    const res = await post(statusHandler, {})
    expect(res.statusCode).toBe(400)
    expect(res.payload).toEqual({ error: 'address and nonce are required' })
  })

  it('rejects an unknown nonce', async () => {
    const signer = makeSigner()
    const proof = await signer.prove()
    const res = await post(statusHandler, { ...proof, nonce: 'deadbeefdeadbeefdeadbeefdeadbeef' })
    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'nonce' })
  })

  it('rejects a proof whose signature comes from a different key', async () => {
    const signer = makeSigner()
    const other = makeSigner()
    const proof = await signer.prove()
    const res = await post(statusHandler, { ...proof, address: other.address })
    expect(res.statusCode).toBe(401)
    expect(res.payload).toMatchObject({ code: 'signature' })
  })

  it('answers 403 not-admin when config.admin is another key', async () => {
    const signer = makeSigner()
    stubConfigRpc({ admin: freshAddress() })
    const res = await post(statusHandler, await signer.prove())
    expect(res.statusCode).toBe(403)
    expect(res.payload).toMatchObject({ code: 'not-admin' })
  })

  it('answers 403 no-config when the config PDA does not exist', async () => {
    const signer = makeSigner()
    stubConfigRpc(null)
    const res = await post(statusHandler, await signer.prove())
    expect(res.statusCode).toBe(403)
    expect(res.payload).toMatchObject({ code: 'no-config' })
  })

  it('answers 502 when the cluster cannot be read', async () => {
    const signer = makeSigner()
    stubConfigRpc('fail')
    const res = await post(statusHandler, await signer.prove())
    expect(res.statusCode).toBe(502)
    expect(res.payload).toMatchObject({ code: 'rpc' })
  })

  it('answers 200 for config.admin — roles, allowlist and provider flags', async () => {
    const signer = makeSigner()
    const stranger = freshAddress()
    stubConfigRpc({ admin: signer.address })
    process.env.SGT_DEV_ALLOWLIST = ` ${stranger} `
    process.env.RESEND_API_KEY = 're_test'
    process.env.GEMINI_API_KEY = 'gm_test'

    const res = await post(statusHandler, await signer.prove())
    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({
      config: { admin: signer.address, verifier: VERIFIER_ROLE, oracle: ORACLE_ROLE },
      allowlist: { entries: [stranger], source: 'env' },
      api: { email: true, sas: expect.any(Boolean), ai: true },
    })
  })
})

/* ── POST /api/admin/allowlist ───────────────────────────────────────────── */

describe('POST /api/admin/allowlist', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await allowlistHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('refuses a valid sign-in that is not the on-chain admin', async () => {
    const signer = makeSigner()
    const newcomer = freshAddress()
    stubConfigRpc({ admin: freshAddress() })

    const res = await post(allowlistHandler, { ...(await signer.prove()), add: [newcomer] })
    expect(res.statusCode).toBe(403)
    expect(res.payload).toMatchObject({ code: 'not-admin' })
  })

  it('rejects malformed operations', async () => {
    const signer = makeSigner()
    stubConfigRpc({ admin: signer.address })

    const notArray = await post(allowlistHandler, { ...(await signer.prove()), add: 'everyone' })
    expect(notArray.statusCode).toBe(400)

    const badAddress = await post(allowlistHandler, { ...(await signer.prove()), add: ['not-an-address'] })
    expect(badAddress.statusCode).toBe(400)

    const empty = await post(allowlistHandler, await signer.prove())
    expect(empty.statusCode).toBe(400)
  })

  it('adds entries through a runtime override and reports the new list', async () => {
    const signer = makeSigner()
    const envEntry = freshAddress()
    const newcomer = freshAddress()
    stubConfigRpc({ admin: signer.address })
    process.env.SGT_DEV_ALLOWLIST = envEntry

    const res = await post(allowlistHandler, { ...(await signer.prove()), add: [newcomer] })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ entries: [envEntry, newcomer], source: 'runtime', list: 'dev' })

    // The status route now reports the override, not the env list.
    const status = await post(statusHandler, await signer.prove())
    expect(status.payload).toMatchObject({ allowlist: { entries: [envEntry, newcomer], source: 'runtime' } })

    // …and removal drops back to the env base.
    const removed = await post(allowlistHandler, { ...(await signer.prove()), remove: [newcomer] })
    expect(removed.payload).toEqual({ entries: [envEntry], source: 'runtime', list: 'dev' })
  })

  it('lets a freshly added wallet sign in through /api/siws/verify', async () => {
    const admin = makeSigner()
    const newcomer = makeSigner()
    stubConfigRpc({ admin: admin.address })
    // Fail-closed base: nothing eligible until the admin adds the wallet.

    const added = await post(allowlistHandler, { ...(await admin.prove()), add: [newcomer.address] })
    expect(added.statusCode).toBe(200)

    const verified = await post(verifyHandler, await newcomer.prove())
    expect(verified.statusCode).toBe(200)
    expect(verified.payload).toMatchObject({ verified: true, address: newcomer.address, method: 'allowlist' })
  })

  it('removing the wildcard fails the allowlist closed again', async () => {
    const admin = makeSigner()
    const passerby = makeSigner()
    stubConfigRpc({ admin: admin.address })
    process.env.SGT_DEV_ALLOWLIST = '*'

    // Wildcard base — anyone verified can sign in…
    expect((await post(verifyHandler, await passerby.prove())).payload).toMatchObject({ verified: true })

    // …until the admin removes it.
    const removed = await post(allowlistHandler, { ...(await admin.prove()), remove: ['*'] })
    expect(removed.payload).toEqual({ entries: [], source: 'runtime', list: 'dev' })
    expect((await post(verifyHandler, await passerby.prove())).payload).toMatchObject({
      verified: false,
      reason: 'not-allowlisted',
    })
  })
})

/* ── POST /api/admin/allowlist — list: 'operator' ────────────────────────── */

describe('POST /api/admin/allowlist — the operator list', () => {
  it('updates the operator list and says which one it answered', async () => {
    const admin = makeSigner()
    const envEntry = freshAddress()
    const newcomer = freshAddress()
    stubConfigRpc({ admin: admin.address })
    process.env.OPERATOR_ALLOWLIST = envEntry

    const res = await post(allowlistHandler, { ...(await admin.prove()), list: 'operator', add: [newcomer] })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ entries: [envEntry, newcomer], source: 'runtime', list: 'operator' })

    // Status reports both lists, each with its own layer.
    const status = await post(statusHandler, await admin.prove())
    expect(status.payload).toMatchObject({
      operatorAllowlist: { entries: [envEntry, newcomer], source: 'runtime' },
      allowlist: { entries: [], source: 'env' },
    })

    // …and removal falls back to the operator env base, not the dev one.
    const removed = await post(allowlistHandler, { ...(await admin.prove()), list: 'operator', remove: [newcomer] })
    expect(removed.payload).toEqual({ entries: [envEntry], source: 'runtime', list: 'operator' })
  })

  it('routes to the operator list only when asked — the dev list is the default', async () => {
    const admin = makeSigner()
    const devEntry = freshAddress()
    stubConfigRpc({ admin: admin.address })

    const res = await post(allowlistHandler, { ...(await admin.prove()), add: [devEntry] })

    expect(res.payload).toMatchObject({ list: 'dev' })
    const status = await post(statusHandler, await admin.prove())
    expect(status.payload).toMatchObject({
      allowlist: { entries: [devEntry], source: 'runtime' },
      // Nothing landed on the operator list.
      operatorAllowlist: { entries: [], source: 'env' },
    })
  })

  it('rejects an unknown list name rather than silently editing the dev one', async () => {
    const admin = makeSigner()
    stubConfigRpc({ admin: admin.address })

    const res = await post(allowlistHandler, { ...(await admin.prove()), list: 'everyone', add: [freshAddress()] })

    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ error: expect.stringContaining("list must be 'dev' or 'operator'") })
  })
})
