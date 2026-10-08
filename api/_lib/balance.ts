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
 * Used by classify (OpenAI ⇄ Gemini), classify-gemini (Gemini ⇄ OpenAI) and
 * assistant (Groq → OpenAI). Grade already carries its own two opinions.
 */

import { ClassificationError } from '@/features/ai/types'

export interface ProviderAttempt<T> {
  /** Provider name — carried in the result for logging/tests, never leaked to clients. */
  name: string
  run: () => Promise<T>
}

export interface BalanceResult<T> {
  value: T | null
  /** Which attempt produced it; `null` when every provider failed. */
  via: string | null
  /** The primary's failure — what a total outage reports, preserving its contract. */
  firstError: unknown
}

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
export async function balanceProviders<T>(attempts: ProviderAttempt<T>[]): Promise<BalanceResult<T>> {
  let firstError: unknown = new Error('no provider attempted')
  for (const [index, attempt] of attempts.entries()) {
    try {
      const value = await attempt.run()
      return { value, via: attempt.name, firstError: null }
    } catch (error) {
      if (isClientFault(error)) return { value: null, via: null, firstError: error }
      if (index === 0) firstError = error
    }
  }
  return { value: null, via: null, firstError }
}
