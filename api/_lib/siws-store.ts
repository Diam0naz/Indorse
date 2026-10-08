/**
 * api/_lib/siws-store.ts — single-use SIWS nonce store
 *
 * Every issued payload lives under its nonce with a short TTL and can be
 * consumed exactly once: `consume` reads-and-burns atomically, so two
 * concurrent requests can never both accept the same nonce.
 *
 * Two backends sit behind the same async `SiwsStore` interface:
 *
 *   - `InMemorySiwsStore` — per-process `Map`, the default. Correct for the
 *     local runner (`npm run api:dev`) and for tests, and for any host that
 *     runs a single long-lived instance.
 *   - `RedisSiwsStore` — Serverless Redis over HTTP (Upstash REST). Required
 *     the moment the API runs multi-instance: on a serverless host the
 *     `/api/siws/nonce` and `/api/siws/verify` calls can land on different
 *     instances, and a per-process Map would 401 every sign-in. `GETDEL` is
 *     the atomic read-and-burn the interface promises.
 *
 * The backend is selected by env at module load: both `UPSTASH_REDIS_REST_URL`
 * and `UPSTASH_REDIS_REST_TOKEN` set → Redis; otherwise in-memory. Nothing
 * else selects it, so a deployment that forgets the pair fails loudly (401s
 * from mismatched instances) rather than silently.
 *
 * HTTP/REST is deliberate: serverless functions cannot hold a TCP Redis
 * connection open across invocations without pooling problems.
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

/**
 * The contract every backend implements. `consume` burns the nonce: a
 * successful read deletes it in the same step, so a replayed proof finds
 * nothing.
 */
export interface SiwsStore {
  /** Store a payload under its nonce until it expires. */
  issue(payload: IssuedSiwsPayload): Promise<void>
  /**
   * Look up and burn a nonce in one step. Unknown, expired and already-used
   * nonces all return null — the caller cannot tell them apart (by design)
   * and answers 401 either way.
   */
  consume(nonce: string): Promise<IssuedSiwsPayload | null>
}

interface Entry {
  payload: IssuedSiwsPayload
  expiresAt: number
}

/**
 * Synchronous in-memory primitive. Kept sync (not part of `SiwsStore`) so the
 * expiry/sweep behaviour stays trivially unit-testable without awaiting.
 */
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

  /** Look up and burn a nonce in one step — see `SiwsStore.consume`. */
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

/** `SiwsStore` over the in-memory primitive — the default backend. */
class InMemorySiwsStore implements SiwsStore {
  constructor(private readonly inner: SiwsNonceStore = new SiwsNonceStore()) {}

  async issue(payload: IssuedSiwsPayload): Promise<void> {
    this.inner.issue(payload)
  }

  async consume(nonce: string): Promise<IssuedSiwsPayload | null> {
    return this.inner.consume(nonce)
  }
}

/** Key namespace so a shared Redis instance can host more than this store. */
const REDIS_KEY_PREFIX = 'siws:nonce:'

/** Minimal fetch surface — injectable so tests never touch a real database. */
export type SiwsFetch = (input: string, init?: RequestInit) => Promise<Response>

/** One Upstash-REST command: `{ result }` on success, `{ error }` on failure. */
interface RedisCommandResponse {
  result?: unknown
  error?: string
}

/**
 * `SiwsStore` over Upstash's HTTP REST API. Commands are sent as a single
 * JSON array in the body, exactly as the REST spec documents
 * (`["GETDEL", key]`), and an outage throws rather than answering "no nonce".
 */
export class RedisSiwsStore implements SiwsStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly ttlMs: number = SIWS_TTL_MS,
    private readonly fetchImpl: SiwsFetch = (input, init) => fetch(input, init),
  ) {}

  async issue(payload: IssuedSiwsPayload): Promise<void> {
    // PX TTL lets Redis expire the record — the in-memory sweep has no peer here.
    await this.command(['SET', this.key(payload.nonce), JSON.stringify(payload), 'PX', this.ttlMs])
  }

  async consume(nonce: string): Promise<IssuedSiwsPayload | null> {
    const result = await this.command(['GETDEL', this.key(nonce)])
    if (typeof result !== 'string') return null
    try {
      return JSON.parse(result) as IssuedSiwsPayload
    } catch {
      return null // Unreadable residue — treat as absent, never as a valid proof.
    }
  }

  private key(nonce: string): string {
    return `${REDIS_KEY_PREFIX}${nonce}`
  }

  private async command(args: (string | number)[]): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    if (!response.ok) throw new Error(`SIWS store responded ${response.status}`)
    const body = (await response.json()) as RedisCommandResponse
    if (body.error) throw new Error(`SIWS store: ${body.error}`)
    return body.result
  }
}

/** The env keys that switch the shared backend on. Both are required. */
export const SIWS_STORE_ENV_KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const

/**
 * Pick the backend for this process: Serverless Redis when both REST keys are
 * configured, otherwise the in-memory default.
 */
export function createSiwsStore(env: Record<string, string | undefined> = process.env): SiwsStore {
  const url = env.UPSTASH_REDIS_REST_URL?.trim()
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (url && token) return new RedisSiwsStore(url, token)
  return new InMemorySiwsStore()
}

/** Process-wide store — shared across instances only when Redis is configured. */
export const siwsStore: SiwsStore = createSiwsStore()
