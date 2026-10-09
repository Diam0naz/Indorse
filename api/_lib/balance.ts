/**
 * api/_lib/balance.ts — provider failover for the AI routes
 *
 * The AI features are core, so a single provider's quota wall, outage or dead
 * key must not take them down: each route runs an ORDERED list of provider
 * attempts and answers from the first one that succeeds. The primary's
 * contract is preserved end to end — a total failure reports the FIRST
 * error's code/status, and client-side request faults (same payload, same
 * verdict on every provider) never trigger a retry.
 *
 * DEADLINE-AWARE: an ordered failover only helps if the fallback actually
 * gets to run. With fixed per-provider deadlines, a primary that stalls can
 * consume the whole invocation (and the app's own client deadline) before the
 * next provider is ever dialled — so the failover silently becomes dead code.
 * A caller passes `totalMs`; each attempt then receives `min(its own
 * budgetMs, whatever remains)`, and a fast primary failure hands its unused
 * time to the fallback instead of wasting it.
 *
 * Used by classify (OpenAI ⇄ Gemini), classify-gemini (Gemini ⇄ OpenAI) and
 * assistant (Groq → OpenAI). Grade already carries its own two opinions.
 */

import { ClassificationError } from './ai-types'

export interface ProviderAttempt<T> {
  /** Provider name — carried in the result for logging/tests, never leaked to clients. */
  name: string
  /**
   * Ceiling for THIS attempt in ms. Omitted = the attempt may spend whatever
   * the shared budget has left — correct for the last provider in the list,
   * which is the one the others are failing over to.
   */
  budgetMs?: number
  /** The call itself; `timeoutMs` is the time this attempt is allowed. */
  run: (timeoutMs: number) => Promise<T>
}

export interface BalanceOptions {
  /**
   * Wall-clock budget shared by every attempt in ms. Omitted = unbounded,
   * which is right for callers whose providers already enforce their own
   * deadline internally.
   */
  totalMs?: number
}

export interface BalanceResult<T> {
  value: T | null
  /** Which attempt produced it; `null` when every provider failed. */
  via: string | null
  /** The primary's failure — what a total outage reports, preserving its contract. */
  firstError: unknown
}

/**
 * Below this, another round trip cannot plausibly finish before the caller's
 * own deadline. Starting one anyway would only race the client and replace a
 * truthful provider error with a timeout nobody attributes correctly.
 */
export const MIN_ATTEMPT_MS = 1_000

/**
 * `bad-request` is the payload's fault — every provider would reject it the
 * same way, so failing fast saves a pointless second round trip. Everything
 * else (upstream, network, timeout, unauthorized, malformed, raw throws) is
 * provider-specific enough to be worth the next attempt.
 */
export function isClientFault(error: unknown): boolean {
  return error instanceof ClassificationError && error.code === 'bad-request'
}

/** Try each provider in order; the first success wins. */
export async function balanceProviders<T>(
  attempts: ProviderAttempt<T>[],
  options: BalanceOptions = {},
): Promise<BalanceResult<T>> {
  const totalMs = options.totalMs ?? Number.POSITIVE_INFINITY
  const started = Date.now()
  let firstError: unknown = new Error('no provider attempted')

  for (const [index, attempt] of attempts.entries()) {
    const remaining = totalMs - (Date.now() - started)
    const budgetMs = Math.min(attempt.budgetMs ?? remaining, remaining)
    if (budgetMs < MIN_ATTEMPT_MS) break

    try {
      const value = await attempt.run(budgetMs)
      return { value, via: attempt.name, firstError: null }
    } catch (error) {
      if (isClientFault(error)) return { value: null, via: null, firstError: error }
      if (index === 0) firstError = error
    }
  }

  return { value: null, via: null, firstError }
}
