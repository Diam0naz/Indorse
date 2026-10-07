/**
 * api/directory.ts — The farm directory (cross-farm discovery backend)
 *
 * Farm PDAs are derived per owner (`["farm", owner, index]`), so the chain
 * cannot enumerate them: a scout looking for farms beyond their own roster
 * needs a findable list. Devices publish their registered farms here after
 * a roster sync — and the server re-reads every address on devnet before
 * storing it, so a publish can only ever list what the chain actually
 * holds. The directory is a verified CACHE of public `Farm` accounts, never
 * a source of truth: counts go stale, the chain does not.
 *
 *   GET          → { farms: [snapshot] }  (stale snapshots re-read, best effort)
 *   POST { farm }→ publish / refresh one address (per-IP rate limited)
 *
 * Everything stored is already public on-chain (owner, name, coordinates,
 * counts) — the directory only makes it *findable*, which is exactly the
 * privacy posture the Discover card documents. The store is in-memory: a
 * restart starts empty and devices re-publish on their next sync (each
 * publish is idempotent, so this self-heals).
 *
 * Devnet by default (`CLUSTER_URLS.devnet`) — same cluster the app reads.
 */

import { address as parseAddress } from '@solana/kit'
import { CLUSTER_URLS } from '@/constants/app-config'
import { fromE6 } from '@/lib/format'
import { createProgramRpc, fetchAccount } from '@/lib/program'
import type { Farm } from '@/features/farm/types'
import { parseBody, type ProxyRequest, type ProxyResponse } from './_lib/proxy'

/** One directory row — a snapshot of a public `Farm` account. */
export interface DirectoryFarm {
  address: string
  name: string
  /** Decimal degrees — the Discover card renders these as-is (chain-public). */
  lat: number
  lng: number
  owner: string
  reportCount: number
  verifiedReportCount: number
  batchCount: number
  policyCount: number
  /** Snapshot time (ms) — how old the counts are, not chain data. */
  updatedAt: number
}

/** Snapshots older than this are re-read on the next GET (best effort). */
export const STALE_MS = 60_000

/** Per-IP publish budget: a roster is a handful of farms, spam is not. */
export const RATE_LIMIT = { max: 30, windowMs: 60_000 }

export interface DirectoryDeps {
  /** Chain read for one address — `null` means "not a farm account". Injectable for tests. */
  readFarm: (farmAddress: string) => Promise<DirectoryFarm | null>
  now: () => number
  staleMs: number
}

/** Default chain read: decode the `Farm` account on devnet. */
async function defaultReadFarm(farmAddress: string): Promise<DirectoryFarm | null> {
  const rpc = createProgramRpc(CLUSTER_URLS.devnet)
  try {
    const farm = await fetchAccount<Farm>(rpc, farmAddress, 'Farm')
    if (!farm) return null
    return {
      address: farmAddress,
      name: farm.name,
      lat: fromE6(farm.latE6),
      lng: fromE6(farm.lngE6),
      owner: farm.owner,
      reportCount: farm.reportCount,
      verifiedReportCount: farm.verifiedReportCount,
      batchCount: farm.batchCount,
      policyCount: farm.policyCount,
      updatedAt: 0, // stamped by the caller against its own clock
    }
  } catch (error) {
    // A discriminator mismatch is a wrong account type — a bad publish, not
    // an RPC outage. Anything else (429s, timeouts) propagates as 502.
    if (error instanceof Error && error.message.includes('Discriminator mismatch')) return null
    throw error
  }
}

/**
 * One handler per process: its store and its rate-limit counters live and
 * die with it (tests build their own, so no global reset seam is needed).
 */
export function createDirectoryHandler(
  partial: Partial<DirectoryDeps> = {},
): (req: ProxyRequest, res: ProxyResponse) => Promise<void> {
  const readFarm = partial.readFarm ?? defaultReadFarm
  const now = partial.now ?? Date.now
  const staleMs = partial.staleMs ?? STALE_MS

  const store = new Map<string, DirectoryFarm>()
  const hits = new Map<string, number[]>()

  /** Fixed-window per-IP counter — same shape as the assistant's limiter. */
  function allowPublish(key: string, at: number): boolean {
    const windowStart = at - RATE_LIMIT.windowMs
    const recent = (hits.get(key) ?? []).filter((stamp) => stamp > windowStart)
    if (recent.length >= RATE_LIMIT.max) {
      hits.set(key, recent)
      return false
    }
    recent.push(at)
    hits.set(key, recent)
    return true
  }

  /** Re-read snapshots past the TTL; a failed read keeps the stale row. */
  async function refreshStale(): Promise<void> {
    const cutoff = now() - staleMs
    const stale = [...store.values()].filter((row) => row.updatedAt < cutoff)
    await Promise.all(
      stale.map(async (row) => {
        try {
          const fresh = await readFarm(row.address)
          if (fresh) store.set(row.address, { ...fresh, updatedAt: now() })
        } catch {
          // RPC hiccup — serve the stale snapshot rather than hide the farm.
        }
      }),
    )
  }

  return async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
    if (req.method === 'POST') {
      const at = now()
      if (!allowPublish(req.ip ?? 'no-ip', at)) {
        res.status(429).json({ error: 'rate-limited' })
        return
      }
      const body = parseBody(req.body)
      const raw = typeof body.farm === 'string' ? body.farm.trim() : ''
      let farmAddress: string
      try {
        farmAddress = parseAddress(raw)
      } catch {
        res.status(400).json({ error: 'bad-address' })
        return
      }
      let farm: DirectoryFarm | null
      try {
        farm = await readFarm(farmAddress)
      } catch {
        res.status(502).json({ error: 'rpc-unavailable' })
        return
      }
      if (!farm) {
        res.status(404).json({ error: 'not-a-farm' })
        return
      }
      const snapshot = { ...farm, updatedAt: now() }
      store.set(farmAddress, snapshot)
      res.status(200).json({ farm: snapshot })
      return
    }

    // GET (and any other method — listing is harmless): refresh, then answer.
    await refreshStale()
    res.status(200).json({ farms: [...store.values()] })
  }
}

/** The process-wide handler serve-api mounts. */
const handler = createDirectoryHandler()
export default handler
