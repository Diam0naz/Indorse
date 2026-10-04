/**
 * features/ai/usePhotoClassification — classify a captured field photo
 *
 * Owns the classification lifecycle for the scout camera flow:
 *
 *   classify(base64) ──▶ getClassifyEndpoint() ──▶ classifyPhoto() ──▶ state
 *
 * - Without a configured proxy endpoint (`EXPO_PUBLIC_AI_CLASSIFY_URL`) or
 *   captured bytes it resolves `null` immediately — the demo path never
 *   notices the AI feature exists.
 * - Every failure (offline, proxy down, timeout, malformed reply) collapses
 *   to `null` too: the caller falls back to its seeded label instead of
 *   blocking the scout flow on the network.
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
import type { ClassificationResult } from './types'

/** Cap the wait so a slow proxy cannot hold the submit button hostage. */
const CLASSIFY_TIMEOUT_MS = 10_000

export interface PhotoClassification {
  /** Last landed diagnosis, or `null` while pending / when unavailable. */
  classification: ClassificationResult | null
  /** True from the moment a request starts until it lands or fails. */
  classifying: boolean
  /** Classify captured bytes; always resolves (failures collapse to `null`). */
  classify: (imageBase64: string) => Promise<ClassificationResult | null>
  /** Drop current state and orphan any in-flight request (retake). */
  reset: () => void
}

export function usePhotoClassification(): PhotoClassification {
  const [classification, setClassification] = useState<ClassificationResult | null>(null)
  const [classifying, setClassifying] = useState(false)
  const generation = useRef(0)

  const reset = useCallback(() => {
    generation.current += 1
    setClassification(null)
    setClassifying(false)
  }, [])

  const classify = useCallback(async (imageBase64: string): Promise<ClassificationResult | null> => {
    const endpoint = getClassifyEndpoint()
    if (!imageBase64 || imageBase64.trim().length === 0 || !endpoint) return null

    const mine = (generation.current += 1)
    setClassification(null)
    setClassifying(true)
    try {
      const result = await classifyPhoto({ imageBase64 }, { endpoint, timeoutMs: CLASSIFY_TIMEOUT_MS })
      if (generation.current === mine) setClassification(result)
      return result
    } catch {
      // Offline, proxy down or malformed reply — the caller keeps its fallback.
      return null
    } finally {
      if (generation.current === mine) setClassifying(false)
    }
  }, [])

  return { classification, classifying, classify, reset }
}
