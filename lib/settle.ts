/**
 * lib/settle.ts — a promise that always settles within a deadline
 *
 * React Native's `AbortController` is advisory: an aborted request may never
 * reject (stalled uploads and GETs have both been left pending), so code that
 * awaits a bare transport with only an abort timer can wait forever. This is
 * the guarantee the abort does not give: after `ms` the returned promise
 * resolves regardless of whether the transport ever does.
 *
 *   await settleAfter(fetch(url, { signal }), 5000)
 *   → the Response, or `null` if it rejected or the deadline passed first
 *
 * Callers that need the failure reason (not just "no answer") should keep
 * their own error handling; this helper is the backstop, not the diagnosis.
 */

export function settleAfter<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    // A pending deadline is not a reason to hold the JS runtime open.
    ;(timer as { unref?: () => void }).unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}
