/**
 * lib/api-net.ts — one wrapped global fetch that survives origin moves
 *
 * Every API client in the app calls the global `fetch` with a URL whose
 * origin is one of ours (`EXPO_PUBLIC_AI_CLASSIFY_URL` + fallbacks). The
 * wrapper installed by `installResilientFetch()` at app bootstrap:
 *
 *   1. passes FOREIGN origins straight through — Solana RPC, CDNs and any
 *      other host are none of this module's business;
 *   2. rewrites a candidate URL to the currently pinned active origin before
 *      the first attempt, so an already-proven working address is used
 *      without waiting for a failure;
 *   3. on a NETWORK-level rejection (dropped adb reverse, DHCP move — never
 *      an HTTP response, even a 5xx) re-races all candidates via
 *      `refreshApiOrigin()` and retries EXACTLY once on whichever answered.
 *
 * The result: a tunnel flap costs one probe round (~sub-second, parallel)
 * instead of a visible error, and an origin shift is absorbed on the first
 * retry. Failures where nothing answers propagate the ORIGINAL error, so
 * every client's error contract is untouched. Unit tests never install the
 * wrapper — they inject their own fetch — so this seam stays invisible to
 * the existing suite.
 */

import { apiOriginCandidates, getApiOrigin, refreshApiOrigin } from './api-origin'

export type FetchInput = Parameters<typeof fetch>[0]
export type FetchLike = (input: FetchInput, init?: RequestInit) => Promise<Response>

export interface ResilientFetchOptions {
  /** Injectable seams (tests); defaults come from `lib/api-origin`. */
  candidates?: () => string[]
  active?: () => string | null
  refresh?: () => Promise<string | null>
}

/** Best-effort href of any fetch input; `null` when we cannot rewrite it safely. */
function hrefOf(input: FetchInput): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  const url = (input as { url?: unknown } | null)?.url
  return typeof url === 'string' ? url : null
}

/** Same URL, different origin (path, query and hash preserved). */
function atOrigin(href: string, origin: string): string {
  try {
    const url = new URL(href)
    return `${origin}${url.pathname}${url.search}${url.hash}`
  } catch {
    return href
  }
}

export function createResilientFetch(base: FetchLike, options: ResilientFetchOptions = {}): FetchLike {
  const candidates = options.candidates ?? apiOriginCandidates
  const active = options.active ?? getApiOrigin
  const refresh = options.refresh ?? (() => refreshApiOrigin({ fetchImpl: base }))

  return async function resilientFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
    const href = hrefOf(input)
    if (href === null) return base(input, init)
    let origin: string
    try {
      origin = new URL(href).origin
    } catch {
      return base(input, init)
    }
    if (!candidates().includes(origin)) return base(input, init)

    const current = active()
    const swapped = current !== null && current !== origin
    const target = swapped ? atOrigin(href, current) : href

    try {
      return swapped ? await base(target, init) : await base(input, init)
    } catch (error) {
      // HTTP responses (500 included) never land here — only rejections do.
      let recovered: string | null = null
      try {
        recovered = await refresh()
      } catch {
        recovered = null
      }
      if (!recovered) throw error
      // The race just proved `recovered` answers — retrying the same target is
      // correct there (a mid-flight tunnel restore), not hammering.
      const retryHref = recovered === origin ? href : atOrigin(href, recovered)
      return base(retryHref, init)
    }
  }
}

interface ResilientGlobal {
  fetch: FetchLike
  __indorseResilientFetch?: boolean
}

/**
 * Wrap the global fetch once (idempotent) and warm the origin race in the
 * background, so the first real request often starts from a pinned winner.
 */
export function installResilientFetch(): void {
  const target = globalThis as unknown as ResilientGlobal
  if (target.__indorseResilientFetch || typeof target.fetch !== 'function') return
  target.__indorseResilientFetch = true
  target.fetch = createResilientFetch(target.fetch)
  void refreshApiOrigin().catch(() => null)
}
