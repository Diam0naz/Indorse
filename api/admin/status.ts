/**
 * api/admin/status.ts — read-only operator status for the admin console
 *
 * The body carries a single-use SIWS proof (address/nonce/signature), which
 * this route verifies before reading the config PDA on-chain and requiring
 * the signer to be `config.admin`. The dev allowlist is NOT part of the gate
 * — protocol authority is decided by the chain, not the entitlement list.
 *
 *   POST /api/admin/status
 *   { address, nonce, signature: number[64], signedMessage: number[] }
 *   → 200 { config: { admin, verifier, oracle },
 *           allowlist: { entries, source },
 *           api: { email, sas, ai } }
 *   → 400 malformed · 401 bad proof · 403 not-admin/no-config · 502 RPC
 *
 * `api` answers with booleans only — whether a backend is configured, never
 * a secret's value.
 */

import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'
import { verifySignInBody } from '../_lib/siws-auth'
import { requireAdmin } from '../_lib/admin-auth'
import { allowlistEntries, allowlistSource } from '../_lib/allowlist'
import { sasConfigFromEnv } from '../_lib/sas'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = verifySignInBody(parseBody(req.body))
  if (!auth.ok) {
    res.status(auth.status).json(auth.error)
    return
  }

  const gate = await requireAdmin(auth.address)
  if (!gate.ok) {
    res.status(gate.status).json(gate.error)
    return
  }

  res.status(200).json({
    config: {
      admin: gate.config.admin,
      verifier: gate.config.verifier,
      oracle: gate.config.oracle,
    },
    allowlist: { entries: allowlistEntries(), source: allowlistSource() },
    api: {
      email: Boolean(process.env.RESEND_API_KEY),
      sas: sasConfigFromEnv() !== null,
      ai: Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
    },
  })
}
