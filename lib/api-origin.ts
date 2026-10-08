/**
 * lib/api-origin.ts — where the app's serverless routes live (POC)
 *
 * One origin serves every route (classify, siws/…). Rather than a second
 * `EXPO_PUBLIC_*` var to keep in sync, derive the origin from
 * `EXPO_PUBLIC_AI_CLASSIFY_URL` — the API URL the app already has to be
 * configured with — so POC deployments still configure exactly one URL.
 * Returns null when no API URL is configured (features then disable
 * themselves instead of guessing).
 *
 * The origin can MOVE under a running app: a dropped adb reverse tunnel or a
 * DHCP lease change turns every `fetch` into a rejection. `refreshApiOrigin`
 * races a liveness probe against every candidate — the configured origin plus
 * the `EXPO_PUBLIC_API_FALLBACKS` list — and pins the first that answers, so
 * `getApiOrigin()` keeps returning a WORKING origin for one round trip
 * instead of a stale literal. Nothing here invents an origin: with no
 * configured URL every feature stays disabled, exactly as before.
 */

/** The origin a probe already proved alive; `null` = "use the configured literal". */
let activeOrigin: string | null = null

/** In-flight refresh, so a burst of failures shares one probe round. */
let inflight: Promise<string | null> | null = null

export function getApiOrigin(): string | null {
  return activeOrigin ?? configuredApiOrigin()
}

/** The origin of `EXPO_PUBLIC_AI_CLASSIFY_URL`, exactly as configured. */
export function configuredApiOrigin(): string | null {
  const endpoint = process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
  if (!endpoint) return null
  try {
    return new URL(endpoint).origin
  } catch {
    return null
  }
}

/**
 * Probe targets: the configured origin plus `EXPO_PUBLIC_API_FALLBACKS` —
 * a comma-separated list of origins or full URLs (anything `new URL` parses;
 * only the origin is used), deduplicated, in declaration order.
 */
export function apiOriginCandidates(): string[] {
  const configured = configuredApiOrigin()
  if (!configured) return []
  const origins = [configured]
  const raw = process.env.EXPO_PUBLIC_API_FALLBACKS ?? ''
  for (const entry of raw.split(',')) {
    const value = entry.trim()
    if (!value) continue
    try {
      const origin = new URL(value).origin
      if (!origins.includes(origin)) origins.push(origin)
    } catch {
      // Junk entries are ignored — a fallback must never break the primary.
    }
  }
  return origins
}

export interface OriginProbeOptions {
  /** Injectable fetch (tests); defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Per-candidate budget. Default 750ms — fast enough to sit in front of a retry. */
  timeoutMs?: number
}

const PROBE_TIMEOUT_MS = 750

/**
 * One candidate: `GET {origin}/api/directory` — a mounted, side-effect-free
 * route that always answers JSON. Any HTTP response counts as alive (the
 * handler 405s other methods); only a rejection or timeout means "next".
 */
async function probeOrigin(origin: string, options: OriginProbeOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  try {
    const response = await fetchImpl(`${origin}/api/directory`, {
      method: 'GET',
      signal: controller?.signal,
    })
    if (!response.ok) throw new Error(`probe answered ${response.status}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Race every candidate in parallel; the first answer wins and becomes the
 * active origin. All fail → `null` and the active origin clears (the next
 * refresh starts from scratch — a moved network deserves a fresh race).
 * Concurrent callers share one in-flight race.
 */
export function refreshApiOrigin(options: OriginProbeOptions = {}): Promise<string | null> {
  if (inflight) return inflight
  const candidates = apiOriginCandidates()
  if (candidates.length === 0) return Promise.resolve(null)
  inflight = new Promise<string | null>((resolve) => {
    let pending = candidates.length
    for (const origin of candidates) {
      probeOrigin(origin, options).then(
        () => resolve(origin),
        () => {
          pending -= 1
          if (pending === 0) resolve(null)
        },
      )
    }
  }).then((winner) => {
    activeOrigin = winner
    inflight = null
    return winner
  })
  // A rejected race must not wedge `inflight` — refresh never rejects, but
  // clear defensively anyway.
  inflight.catch(() => {
    inflight = null
  })
  return inflight
}

/** Drop the pinned origin (tests, or "start over" after a hard failure). */
export function invalidateApiOrigin(): void {
  activeOrigin = null
}
