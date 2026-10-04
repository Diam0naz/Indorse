/**
 * api/siws/nonce.ts — issue the SIWS payload for device verification (step 1)
 *
 * The server fills EVERY payload field — domain, uri, statement, chainId,
 * issuedAt, expirationTime and a fresh nonce — and stores the whole payload
 * under the nonce (see `_lib/siws-store.ts`). The client adds only its
 * address and signs; `api/siws/verify.ts` checks that signature against the
 * stored copy, so nothing the client supplies is trusted.
 *
 * `chainId` is pinned to `solana:mainnet` regardless of which cluster the app
 * targets: verification is about mainnet identity (SGT), so a devnet-scoped
 * signature would prove nothing.
 *
 *   POST /api/siws/nonce
 *   → 200 { chainId, domain, expirationTime, issuedAt, nonce, statement, uri, version }
 *
 * Env:
 *   SIWS_DOMAIN — domain the signature binds to (default 'indorse.app')
 *   SIWS_URI    — matching uri                  (default 'https://indorse.app')
 */

import { randomBytes } from 'node:crypto'
import { SIWS_TTL_MS, siwsStore, type IssuedSiwsPayload } from '../_lib/siws-store'
import { type ProxyRequest, type ProxyResponse } from '../_lib/proxy'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const issuedAt = new Date()
  const payload: IssuedSiwsPayload = {
    chainId: 'solana:mainnet',
    domain: process.env.SIWS_DOMAIN || 'indorse.app',
    expirationTime: new Date(issuedAt.getTime() + SIWS_TTL_MS).toISOString(),
    issuedAt: issuedAt.toISOString(),
    nonce: randomBytes(16).toString('hex'),
    statement: 'Sign in to verify this device',
    uri: process.env.SIWS_URI || 'https://indorse.app',
    version: '1',
  }

  siwsStore.issue(payload)
  res.status(200).json(payload)
}
