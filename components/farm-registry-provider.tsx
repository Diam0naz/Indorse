/**
 * components/farm-registry-provider.tsx — The operator's farms
 *
 * One AsyncStorage document (`indorse.farms.v1`) holds every farm this
 * device keeps:
 *
 *   - farms registered on-chain — mirrored in by `FarmChainSync`, badged
 *     `source: 'chain'` with their PDA address and report count;
 *   - farms saved on this device only — `source: 'local'` (added when no
 *     wallet is connected, or kept as a draft).
 *
 * `currentId` is the selection the shared header pill features: whatever
 * farm is current shows in the pill, and through it on every screen. The
 * newest farm becomes current when none is selected yet; a stale id falls
 * back to the first farm so the pill never renders a ghost.
 *
 * Writes are fire-and-forget like ProfileProvider/SettingsProvider: the
 * in-memory state is the session's source of truth. The default context
 * (no provider — every test renders without one) reports `ready: true,
 * farms: []` with no-op mutations.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORE_KEY = 'indorse.farms.v1'

export interface FarmEntry {
  /** The chain PDA for on-chain farms, a generated id for local ones. */
  id: string
  name: string
  /** Decimal degrees, exactly what the register form collects. */
  lat: number
  lng: number
  source: 'chain' | 'local'
  /** Present for on-chain farms — the farm account address. */
  address?: string
  /** On-chain report count, mirrored from the farm account. */
  reportCount?: number
  /**
   * Acreage — device-local: the chain account has no such field, so this
   * lives only here (absent on entries recorded before the input existed).
   */
  acres?: number
  addedAt: number
}

export interface AddFarmInput {
  name: string
  lat: number
  lng: number
  source: 'chain' | 'local'
  /** The PDA when registering on-chain — doubles as the stable id. */
  address?: string
  /** Acres typed at registration — local detail, never sent on-chain. */
  acres?: number
}

interface FarmRegistryDoc {
  farms: FarmEntry[]
  currentId: string | null
}

interface FarmRegistryValue {
  /** False while the stored document is being read. */
  ready: boolean
  farms: FarmEntry[]
  /** The farm the pill features — `currentId` when it resolves, else the first. */
  current: FarmEntry | null
  currentId: string | null
  /** Add (or upsert, keyed by address) a farm and make it current. */
  addFarm: (input: AddFarmInput) => FarmEntry
  /** Mirror the wallet's on-chain farm — badge + stats, never duplicates. */
  upsertChainFarm: (input: { name: string; lat: number; lng: number; address: string; reportCount: number }) => void
  /** Feature this farm in the header pill everywhere. */
  setCurrent: (id: string) => void
  /** Drop a registry entry (e.g. after its on-chain record was deleted). */
  removeFarm: (id: string) => void
  /** Erase the whole registry — part of "delete local account data". */
  reset: () => void
}

function generateLocalId(): string {
  return `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const DEFAULT_VALUE: FarmRegistryValue = {
  ready: true,
  farms: [],
  current: null,
  currentId: null,
  addFarm: (input) => ({
    id: input.address ?? generateLocalId(),
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    source: input.source,
    address: input.address,
    acres: input.acres,
    addedAt: Date.now(),
  }),
  upsertChainFarm: () => {},
  setCurrent: () => {},
  removeFarm: () => {},
  reset: () => {},
}

const FarmRegistryContext = createContext<FarmRegistryValue>(DEFAULT_VALUE)

export function FarmRegistryProvider({ children }: PropsWithChildren) {
  const [farms, setFarms] = useState<FarmEntry[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Read the stored document once; writes below are skipped until it lands
  // so a slow read can never wipe a session that already made changes.
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!active || !raw) return
        const doc = JSON.parse(raw) as Partial<FarmRegistryDoc>
        if (Array.isArray(doc.farms)) setFarms(doc.farms)
        if (typeof doc.currentId === 'string') setCurrentId(doc.currentId)
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
    const doc: FarmRegistryDoc = { farms, currentId }
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(doc)).catch(() => {})
  }, [ready, farms, currentId])

  const addFarm = useCallback((input: AddFarmInput): FarmEntry => {
    const entry: FarmEntry = {
      id: input.address ?? generateLocalId(),
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      source: input.source,
      address: input.address,
      acres: input.acres,
      addedAt: Date.now(),
    }
    setFarms((prev) => {
      const existing = prev.findIndex((f) => f.id === entry.id)
      if (existing >= 0) {
        const next = [...prev]
        // Acres only ever arrives explicitly: a re-register that omits
        // the field must not erase what the first pass recorded.
        next[existing] = {
          ...next[existing],
          ...entry,
          acres: entry.acres ?? next[existing].acres,
          addedAt: next[existing].addedAt,
        }
        return next
      }
      return [...prev, entry]
    })
    setCurrentId(entry.id)
    return entry
  }, [])

  const upsertChainFarm = useCallback(
    (input: { name: string; lat: number; lng: number; address: string; reportCount: number }) => {
      setFarms((prev) => {
        const existing = prev.findIndex((f) => f.id === input.address)
        if (existing >= 0) {
          const current = prev[existing]
          // Unchanged content → same array: a re-sync must not churn the
          // context (or a listener could feed back into itself).
          if (
            current.name === input.name &&
            current.lat === input.lat &&
            current.lng === input.lng &&
            current.reportCount === input.reportCount &&
            current.source === 'chain'
          ) {
            return prev
          }
          const next = [...prev]
          next[existing] = { ...current, ...input, source: 'chain' }
          return next
        }
        return [...prev, { ...input, id: input.address, source: 'chain' as const, addedAt: Date.now() }]
      })
      // First farm seen claims the pill; an existing selection keeps it.
      setCurrentId((current) => current ?? input.address)
    },
    [],
  )

  const setCurrent = useCallback((id: string) => setCurrentId(id), [])

  const removeFarm = useCallback((id: string) => {
    setFarms((prev) => {
      const next = prev.filter((f) => f.id !== id)
      return next.length === prev.length ? prev : next
    })
    // currentId is left alone — resolvedId falls back to the first entry
    // when the selected farm is gone.
  }, [])

  const reset = useCallback(() => {
    setFarms([])
    setCurrentId(null)
  }, [])

  // A selection pointing at a removed/absent farm falls back to the first —
  // the pill renders farms[0] so it never shows nothing while one exists.
  const resolvedId = useMemo(() => {
    if (currentId && farms.some((f) => f.id === currentId)) return currentId
    return farms[0]?.id ?? null
  }, [currentId, farms])

  const current = useMemo(() => farms.find((f) => f.id === resolvedId) ?? null, [farms, resolvedId])

  const value = useMemo(
    () => ({ ready, farms, current, currentId: resolvedId, addFarm, upsertChainFarm, setCurrent, removeFarm, reset }),
    [ready, farms, current, resolvedId, addFarm, upsertChainFarm, setCurrent, removeFarm, reset],
  )

  return <FarmRegistryContext.Provider value={value}>{children}</FarmRegistryContext.Provider>
}

export function useFarmRegistry(): FarmRegistryValue {
  return useContext(FarmRegistryContext)
}
