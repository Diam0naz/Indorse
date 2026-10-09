/**
 * features/ai/usePhotoClassification — classify a captured field photo
 *
 * Owns the classification lifecycle for the scout camera flow:
 *
 *   classify(images[]) ──▶ getClassifyEndpoint() ──▶ classifyPhoto() ──▶ state
 *
 * - Without a configured proxy endpoint (`EXPO_PUBLIC_AI_CLASSIFY_URL`) or
 *   captured bytes it resolves `null` immediately — the demo path never
 *   notices the AI feature exists. Every shot goes in one call, so a single
 *   verdict weighs all the angles of the plant together.
 * - Every failure (offline, proxy down, timeout, malformed reply) collapses
 *   to `null` too: the caller falls back to its seeded label instead of
 *   blocking the scout flow on the network. The failure itself is kept in
 *   `error` so the caller can be specific when it wants to be.
 * - The body is trimmed to the proxy's upload budget (`selectUploadable`)
 *   before it leaves the device: the host rejects an oversized body with a
 *   413 that never reaches the handler, so sending fewer shots beats sending
 *   a report that cannot succeed.
 * - A watchdog settles `classify` even if the transport never does. An
 *   AbortController only ends the promise if the platform honours the abort;
 *   a stalled large upload can otherwise leave `classifying` true forever.
 * - A generation token guards the state: `reset()` (retake) orphans an
 *   in-flight request, so a previous photo's diagnosis can never land on a
 *   new scan.
 *
 *   const { classification, classifying, classify, reset } = usePhotoClassification()
 *   if (captured?.base64) void classify(captured.base64)
 *   aiLabel: classification?.label ?? demoDiagnosis
 *   severity: classification?.severity ?? demoSeverity
 */

import { useCallback, useRef, useState } from 'react'
import { classifyPhoto, getClassifyEndpoint } from './classify'
import { selectUploadable } from './image'
import { ClassificationError, type ClassificationResult } from './types'

/**
 * Cap the wait so a slow proxy cannot hold the submit button hostage — but
 * not so tight that the proxy's own failover is aborted mid-flight.
 *
 * The route tries Gemini, then OpenAI, each with a 20 s deadline
 * (`GEMINI_TIMEOUT_MS` / `OPENAI_TIMEOUT_MS`), so a stalled primary can take
 * the server ~40 s before the fallback answers. At the old 30 s this client
 * gave up while the failover was still working, so a slow-but-recoverable
 * primary always read as "AI unavailable". 45 s sits above the server's
 * worst case and inside the platform's 60 s `maxDuration` (`vercel.json`).
 */
export const CLASSIFY_TIMEOUT_MS = 45_000

/** Extra time the watchdog allows the transport to settle after a timeout. */
export const WATCHDOG_GRACE_MS = 5_000

export interface PhotoClassification {
  /** Last landed diagnosis, or `null` while pending / when unavailable. */
  classification: ClassificationResult | null
  /** True from the moment a request starts until it lands or fails. */
  classifying: boolean
  /** Why the last attempt produced no verdict — `null` when none failed. */
  error: ClassificationError | null
  /** Classify every captured shot in one call; failures collapse to `null`. */
  classify: (images: string[]) => Promise<ClassificationResult | null>
  /** Drop current state and orphan any in-flight request (retake). */
  reset: () => void
}

export function usePhotoClassification(): PhotoClassification {
  const [classification, setClassification] = useState<ClassificationResult | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [error, setError] = useState<ClassificationError | null>(null)
  const generation = useRef(0)

  const reset = useCallback(() => {
    generation.current += 1
    setClassification(null)
    setError(null)
    setClassifying(false)
  }, [])

  const classify = useCallback(async (images: string[]): Promise<ClassificationResult | null> => {
    const endpoint = getClassifyEndpoint()
    const bytes = images.map((value) => value.trim()).filter((value) => value.length > 0)
    if (bytes.length === 0 || !endpoint) return null

    // Never upload bytes the host is about to reject (413). Downscaling keeps
    // this a no-op in practice; it is the backstop for captures whose
    // re-encode failed and stayed at full resolution.
    const { images: uploadable } = selectUploadable(bytes.map((imageBase64) => ({ imageBase64 })))
    if (uploadable.length === 0) {
      setError(new ClassificationError('payload-too-large', 'Captured photos exceed the classifier upload budget'))
      return null
    }

    const mine = (generation.current += 1)
    setClassification(null)
    setError(null)
    setClassifying(true)
    try {
      const result = await withWatchdog(
        classifyPhoto({ images: uploadable }, { endpoint, timeoutMs: CLASSIFY_TIMEOUT_MS }),
        CLASSIFY_TIMEOUT_MS + WATCHDOG_GRACE_MS,
      )
      if (generation.current === mine) setClassification(result)
      return result
    } catch (failure) {
      if (generation.current === mine) setError(asClassificationError(failure))
      return null
    } finally {
      if (generation.current === mine) setClassifying(false)
    }
  }, [])

  return { classification, classifying, error, classify, reset }
}

/**
 * Resolve `null` if `promise` has not settled after `ms`. `classifyPhoto`'s
 * AbortController is the normal path out of a slow request; this is the
 * guarantee that the UI moves on even when a platform never rejects a request
 * it was told to abort (React Native has left stalled uploads pending).
 */
function withWatchdog<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms)
    // A pending watchdog is not a reason to hold the JS runtime open.
    ;(timer as { unref?: () => void }).unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (failure) => {
        clearTimeout(timer)
        reject(failure)
      },
    )
  })
}

/** Keep the caller's contract (`null` means "no verdict") while naming the cause. */
function asClassificationError(failure: unknown): ClassificationError {
  if (failure instanceof ClassificationError) return failure
  return new ClassificationError('network', failure instanceof Error ? failure.message : 'Classification failed')
}
