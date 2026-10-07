/**
 * Recency without a scan — the one line worth protecting.
 *
 * `docs/discovery.md` used to list "no recency signal" as a known edge on the
 * grounds that report timestamps would mean reading every report account per
 * farm. They do not: reports are `["report", farm, u32(index)]` and Farm
 * carries `reportCount`, so the newest report is addressable by index — one
 * `getAccountInfo`.
 *
 * What follows pins that index. Off by one, and the sheet would ask for an
 * account nobody has written yet: the read "succeeds", comes back empty, and
 * reports no date for a farm that plainly has reports. That is the slowest
 * possible failure to notice, because nothing errors — it just quietly looks
 * like a farm nobody has visited.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeAccount } from '@/lib/program/codec'
import { reportPda, type ProgramRpc } from '@/lib/program'
import { fetchLatestReportTimestamp } from './useLatestReportTimestamp'

/** Valid 32-byte address — the pubkey encoder rejects anything shorter. */
const FARM = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx'

/** An RPC whose one `getAccountInfo` answers with `data`, or with nothing. */
function rpcReturning(data: [string, string] | null): ProgramRpc {
  return {
    getAccountInfo: vi.fn(() => ({ send: async () => ({ value: data ? { data } : null }) })),
  } as unknown as ProgramRpc
}

/** A real encoded `ScoutReport` carrying `timestamp`. */
function reportAt(timestamp: number): [string, 'base64'] {
  const bytes = encodeAccount('ScoutReport', {
    farm: FARM,
    reporter: FARM,
    index: 7,
    photoHash: new Array(32).fill(0),
    uri: 'https://cdn.indorse.app/scout/a.jpg',
    latE6: 0,
    lngE6: 0,
    aiLabel: 'Healthy',
    status: 'verified',
    verifier: FARM,
    timestamp,
    bump: 254,
  })
  return [Buffer.from(bytes).toString('base64'), 'base64']
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('fetchLatestReportTimestamp', () => {
  it('reads reportCount - 1 — the newest that exists, not the next to be written', async () => {
    const rpc = rpcReturning(reportAt(1_758_100_000))

    const got = await fetchLatestReportTimestamp(rpc, { address: FARM, reportCount: 8 })

    expect(got).toBe(1_758_100_000)
    // 8 is the index `submit_scout_report` would write next; 7 is the newest
    // account already on chain, and only 7 exists to date.
    expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1)
    expect(rpc.getAccountInfo).toHaveBeenCalledWith(await reportPda(FARM, 7), expect.anything())
  })

  it('returns null when that account is not on chain, rather than inventing a date', async () => {
    const rpc = rpcReturning(null)

    expect(await fetchLatestReportTimestamp(rpc, { address: FARM, reportCount: 3 })).toBeNull()
  })

  it('makes no request at all for a farm with no reports', async () => {
    const rpc = rpcReturning(null)

    // The guard also keeps `reportCount - 1` from ever being -1.
    expect(await fetchLatestReportTimestamp(rpc, { address: FARM, reportCount: 0 })).toBeNull()
    expect(rpc.getAccountInfo).not.toHaveBeenCalled()
  })
})
