/**
 * components/scout-log-provider.tsx — The device's scouting log
 *
 * One AsyncStorage document (`indorse.scout.v1`) holds every locally
 * captured scan, so a capture survives an app restart, a disconnect and a
 * reboot — the session is no longer the boundary of a farmer's work.
 *
 * Rows live an anchoring lifecycle alongside their render fields:
 *
 *   queued   → captured, waiting for a connected wallet + registered farm.
 *              The scout screen's outbox flush submits each row in capture
 *              order; nothing is invented while it waits.
 *   failed   → an anchor attempt did not land. The row and its payload are
 *              kept for an explicit retry — never dropped, never re-tried
 *              in a silent loop.
 *   anchored → the report is on-chain: `id`/`txSig` become the report
 *              address, the payload is released, and the row doubles as the
 *              offline cache of a real chain record.
 *
 * Writes are fire-and-forget like FarmRegistryProvider/ProfileProvider: the
 * in-memory state is the session's source of truth, and nothing is written
 * until the stored document has been read (a slow read can never wipe a
 * session that already made changes). The default context — no provider,
 * which is how every screen test renders — reports `ready: true,
 * events: []` with no-op mutations.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ScoutEvent } from '@/constants/data'

const STORE_KEY = 'indorse.scout.v1'

/** FIFO cap — the newest captures win; anchored rows are re-readable on-chain. */
const MAX_EVENTS = 200

interface ScoutLogDoc {
  events: ScoutEvent[]
}

export interface MarkAnchoredChain {
  /** The report account address returned by `submit_scout_report`. */
  reportAddress: string
  /** The farm name the row was anchored under — the field it now belongs to. */
  field: string
}

interface ScoutLogValue {
  /** False while the stored document is being read. */
  ready: boolean
  events: ScoutEvent[]
  /** Persist a capture (or an optimistically submitted chain row). */
  add: (event: ScoutEvent) => void
  /** The report landed: rewrite the row as its on-chain identity. */
  markAnchored: (id: string, chain: MarkAnchoredChain) => void
  /** An anchor attempt did not land — keep the row and its payload. */
  markFailed: (id: string) => void
  /** Re-queue a failed row; the next flush attempt picks it up. */
  requeue: (id: string) => void
  /** Erase the whole log — part of "delete local account data". */
  reset: () => void
}

const DEFAULT_VALUE: ScoutLogValue = {
  ready: true,
  events: [],
  add: () => {},
  markAnchored: () => {},
  markFailed: () => {},
  requeue: () => {},
  reset: () => {},
}

const ScoutLogContext = createContext<ScoutLogValue>(DEFAULT_VALUE)

/** Lifecycle a capture earns on the way in — derived, never caller-asserted. */
function lifecycleOf(event: ScoutEvent): ScoutEvent['anchorStatus'] {
  if (event.chainStatus) return 'anchored'
  if (event.anchor) return 'queued'
  return event.anchorStatus
}

export function ScoutLogProvider({ children }: PropsWithChildren) {
  const [events, setEvents] = useState<ScoutEvent[]>([])
  const [ready, setReady] = useState(false)

  // Read the stored document once; writes below are skipped until it lands.
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!active || !raw) return
        const doc = JSON.parse(raw) as Partial<ScoutLogDoc>
        if (!Array.isArray(doc.events)) return
        // Repair only what is missing: a payload with no status (written by
        // an older build, or hand-seeded) derives its lifecycle, but an
        // explicit `failed` survives the restart — re-deriving it as queued
        // would retry a known failure in a loop across sessions.
        const events = doc.events
          .slice(0, MAX_EVENTS)
          .map((event) => (event.anchorStatus ? event : { ...event, anchorStatus: lifecycleOf(event) }))
        setEvents(events)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  // Persist on every change once the initial read has settled.
  useEffect(() => {
    if (!ready) return
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ events })).catch(() => {})
  }, [ready, events])

  const add = useCallback((event: ScoutEvent) => {
    setEvents((prev) => {
      const entry: ScoutEvent = { ...event, anchorStatus: lifecycleOf(event) }
      // Upsert by id so a re-emitted row replaces rather than duplicates;
      // newest first, FIFO-capped so storage stays bounded.
      const next = [entry, ...prev.filter((existing) => existing.id !== event.id)]
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
    })
  }, [])

  const markAnchored = useCallback((id: string, chain: MarkAnchoredChain) => {
    setEvents((prev) =>
      prev.map((event) =>
        event.id === id
          ? {
              ...event,
              // The row becomes its on-chain identity; the outbox payload
              // has served its purpose and is released.
              id: chain.reportAddress,
              txSig: chain.reportAddress,
              field: chain.field,
              chainStatus: 'pending' as const,
              anchorStatus: 'anchored' as const,
              anchor: undefined,
            }
          : event,
      ),
    )
  }, [])

  const markFailed = useCallback((id: string) => {
    setEvents((prev) => prev.map((event) => (event.id === id ? { ...event, anchorStatus: 'failed' as const } : event)))
  }, [])

  const requeue = useCallback((id: string) => {
    setEvents((prev) => prev.map((event) => (event.id === id ? { ...event, anchorStatus: 'queued' as const } : event)))
  }, [])

  const reset = useCallback(() => setEvents([]), [])

  const value = useMemo(
    () => ({ ready, events, add, markAnchored, markFailed, requeue, reset }),
    [ready, events, add, markAnchored, markFailed, requeue, reset],
  )

  return <ScoutLogContext.Provider value={value}>{children}</ScoutLogContext.Provider>
}

export function useScoutLog(): ScoutLogValue {
  return useContext(ScoutLogContext)
}
