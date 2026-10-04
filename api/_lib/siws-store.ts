/**
 * api/_lib/siws-store.ts — single-use SIWS nonce store (POC)
 *
 * Every issued payload lives under its nonce with a short TTL and can be
 * consumed exactly once: `consume` deletes before it returns, and single-
 * threaded JS makes that read+delete one atomic step, so two concurrent
 * requests can never both accept the same nonce.
 *
 * In-memory on purpose — the local runner (`npm run api:dev`) is one
 * long-lived process and the POC has nowhere else to put state. A
 * multi-instance deploy needs a shared store with an atomic GETDEL (Redis,
 * SQL); swapping that in is confined to this file.
 */

/** The full SIWS payload — every field pinned at issue time by the server. */
export interface IssuedSiwsPayload {
  chainId: string
  domain: string
  expirationTime: string
  issuedAt: string
  nonce: string
  statement: string
  uri: string
  version: string
}

/** Five minutes: long enough for one wallet prompt, short enough to be useless to a replayer. */
export const SIWS_TTL_MS = 300_000

interface Entry {
  payload: IssuedSiwsPayload
  expiresAt: number
}

export class SiwsNonceStore {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly ttlMs = SIWS_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Store a payload under its nonce until it expires. */
  issue(payload: IssuedSiwsPayload): void {
    this.sweep()
    this.entries.set(payload.nonce, { payload, expiresAt: this.now() + this.ttlMs })
  }

  /**
   * Look up and burn a nonce in one step. Unknown, expired and already-used
   * nonces all return null — the caller cannot tell them apart (by design)
   * and answers 401 either way.
   */
  consume(nonce: string): IssuedSiwsPayload | null {
    const entry = this.entries.get(nonce)
    if (!entry) return null
    this.entries.delete(nonce)
    if (entry.expiresAt <= this.now()) return null
    return entry.payload
  }

  /** Drop expired entries on issue so a long-lived process stays bounded. */
  private sweep(): void {
    const now = this.now()
    for (const [nonce, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(nonce)
    }
  }
}

/** Process-wide store — one per server instance. */
export const siwsStore = new SiwsNonceStore()
