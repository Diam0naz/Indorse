/**
 * api/admin/allowlist.ts — runtime allowlist management
 *
 * Same two gates as `status` (SIWS proof → on-chain `config.admin`), then
 * applies set operations to the effective allowlist through
 * `_lib/allowlist.ts`. The result is a process-local override layered over
 * the list's env base (`SGT_DEV_ALLOWLIST` or `OPERATOR_ALLOWLIST`):
 * additions take effect on the very next check, and the response always
 * states which layer is answering. A restart drops the override back to the
 * env base — the console reports `source` so that is visible rather than
 * mysterious.
 *
 *   POST /api/admin/allowlist
 *   { address, nonce, signature, signedMessage, list?: 'dev' | 'operator',
 *     add?: string[], remove?: string[] }
 *   → 200 { entries, source: 'runtime', list }
 *   → 400 malformed list or ops · 401 bad proof · 403 not-admin · 502 RPC
 *
 * `list` defaults to `'dev'`, so a caller written before the operator list
 * existed keeps managing the one it always managed.
 */

import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'
import { verifySignInBody } from '../_lib/siws-auth'
import { requireAdmin } from '../_lib/admin-auth'
import { allowlistSource, updateAllowlist, type AllowlistName } from '../_lib/allowlist'

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body) as { add?: unknown; remove?: unknown; list?: unknown }

  // Read before the gates: an unknown list is a client bug, and answering
  // 400 for it costs nothing even when the proof would have failed anyway.
  const list: AllowlistName = body.list === undefined ? 'dev' : (body.list as AllowlistName)
  if (list !== 'dev' && list !== 'operator') {
    res.status(400).json({ error: "list must be 'dev' or 'operator'." })
    return
  }

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

  const result = updateAllowlist(list, { add: body.add, remove: body.remove })
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }

  // `list` is echoed back so the console can render the right card without
  // having to remember what it asked for.
  res.status(200).json({ entries: result.entries, source: allowlistSource(list), list })
}
