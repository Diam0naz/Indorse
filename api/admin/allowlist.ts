/**
 * api/admin/allowlist.ts — runtime dev-allowlist management
 *
 * Same two gates as `status` (SIWS proof → on-chain `config.admin`), then
 * applies set operations to the effective allowlist through
 * `_lib/allowlist.ts`. The result is a process-local override layered over
 * `SGT_DEV_ALLOWLIST`: additions take effect on the very next sign-in check,
 * and the response always states which layer is answering. A restart drops
 * the override back to the env base — the console reports `source` so that
 * is visible rather than mysterious.
 *
 *   POST /api/admin/allowlist
 *   { address, nonce, signature, signedMessage, add?: string[], remove?: string[] }
 *   → 200 { entries, source: 'runtime' }
 *   → 400 malformed ops · 401 bad proof · 403 not-admin · 502 RPC
 */

import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'
import { verifySignInBody } from '../_lib/siws-auth'
import { requireAdmin } from '../_lib/admin-auth'
import { allowlistSource, updateAllowlist } from '../_lib/allowlist'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body) as { add?: unknown; remove?: unknown }

  const auth = verifySignInBody(body)
  if (!auth.ok) {
    res.status(auth.status).json(auth.error)
    return
  }

  const gate = await requireAdmin(auth.address)
  if (!gate.ok) {
    res.status(gate.status).json(gate.error)
    return
  }

  const result = updateAllowlist({ add: body.add, remove: body.remove })
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }

  res.status(200).json({ entries: result.entries, source: allowlistSource() })
}
