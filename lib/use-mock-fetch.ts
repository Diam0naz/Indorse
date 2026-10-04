/**
 * lib/use-mock-fetch.ts — Simulated data loading
 *
 * Every screen will eventually read from the chain, so the UI is written
 * against three states — loading, error and ready. Until real queries exist,
 * this hook drives them with a short delay (and, optionally, one failed first
 * attempt so the error + retry path is real UI rather than dead code).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type FetchState = 'loading' | 'error' | 'ready'

interface MockFetchOptions {
  /** Milliseconds before the request "resolves". Default 450. */
  delay?: number
  /** Fail the first attempt so the error state is reachable. Default false. */
  failFirst?: boolean
}

interface MockFetchResult {
  state: FetchState
  /** Re-run the request; retries always resolve successfully. */
  retry: () => void
}

export function useMockFetch({ delay = 450, failFirst = false }: MockFetchOptions = {}): MockFetchResult {
  const [state, setState] = useState<FetchState>('loading')
  const attempt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  /* Initial load: only schedules the resolution, so no state is written
     synchronously from the effect body. */
  useEffect(() => {
    timer.current = setTimeout(() => {
      attempt.current += 1
      setState(failFirst && attempt.current === 1 ? 'error' : 'ready')
    }, delay)
    return clear
  }, [delay, failFirst, clear])

  const retry = useCallback(() => {
    clear()
    attempt.current += 1
    setState('loading')
    timer.current = setTimeout(() => setState('ready'), delay)
  }, [clear, delay])

  return { state, retry }
}
