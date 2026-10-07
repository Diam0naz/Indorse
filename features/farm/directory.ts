/**
 * features/farm/directory.ts — Cross-farm discovery: the pure pieces
 *
 * The Discover card shows OTHER farms — ones the device does not own — so
 * a scout can pick a target and earn against it (the program lets any
 * wallet `submit_scout_report` on any farm; rewards follow the reporter).
 * Everything it displays is already public on-chain; the directory only
 * makes it findable. The helpers here decide what a row says and where it
 * sorts, with no rendering and no fetching of their own beyond the two
 * thin HTTP calls the card and the roster sync share.
 */

import { getApiOrigin } from '@/lib/api-origin'

/** One farm as the directory serves it (mirror of `api/directory.ts`). */
export interface DirectoryFarm {
  address: string
  name: string
  /** Decimal degrees, rendered as-is — chain-public by decision. */
  lat: number
  lng: number
  owner: string
  reportCount: number
  verifiedReportCount: number
  batchCount: number
  policyCount: number
  updatedAt: number
}

/** A directory row enriched for the card. */
export interface DiscoveryFarm extends DirectoryFarm {
  /** Straight-line km from the device — absent while location is unknown. */
  km?: number
  /** Reports written but not yet verified — the "needs scouting" signal. */
  pending: number
  /** Provenance % (verified of total) — `null` while nobody has reported. */
  score: number | null
}

/**
 * The directory rides the app's single configured API origin (one URL rule,
 * see `lib/api-origin`). `null` means unconfigured — features disable
 * themselves instead of guessing, so the Discover card simply stays hidden.
 */
export function directoryEndpoint(origin: string | null = getApiOrigin()): string | null {
  if (!origin) return null
  return `${origin.replace(/\/$/, '')}/api/directory`
}

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance between two WGS84 points (haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Metres under a kilometre, one decimal beyond it: "450 m", "12.3 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

export interface DeriveDiscoveryOptions {
  /** The device's own roster — those farms are in the switcher, not here. */
  excludeAddresses?: readonly string[]
  /** Device position; without it rows carry no distance and sort by name. */
  origin?: { lat: number; lng: number } | null
}

/**
 * Filter → enrich → sort for the card: own farms drop out, distances and
 * needs-scouting facts derive, and rows order nearest-first (unknown
 * position last, name as the tiebreak) so the list is stable.
 */
export function deriveDiscovery(
  farms: readonly DirectoryFarm[],
  options: DeriveDiscoveryOptions = {},
): DiscoveryFarm[] {
  const excluded = new Set(options.excludeAddresses ?? [])
  const rows = farms
    .filter((farm) => farm.address && !excluded.has(farm.address))
    .map<DiscoveryFarm>((farm) => ({
      ...farm,
      ...(options.origin ? { km: haversineKm(options.origin, farm) } : {}),
      pending: Math.max(0, farm.reportCount - farm.verifiedReportCount),
      score: farm.reportCount > 0 ? Math.round((100 * farm.verifiedReportCount) / farm.reportCount) : null,
    }))

  rows.sort((a, b) => {
    const ak = a.km ?? Number.POSITIVE_INFINITY
    const bk = b.km ?? Number.POSITIVE_INFINITY
    if (ak !== bk) return ak - bk
    return a.name.localeCompare(b.name) || a.address.localeCompare(b.address)
  })
  return rows
}

/** Directory responses are remote data — accept only rows that parse. */
export function isDirectoryFarm(value: unknown): value is DirectoryFarm {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.address === 'string' &&
    row.address.length > 0 &&
    typeof row.name === 'string' &&
    typeof row.lat === 'number' &&
    typeof row.lng === 'number' &&
    typeof row.reportCount === 'number' &&
    typeof row.verifiedReportCount === 'number'
  )
}

/** GET the directory. Throws on a non-200 or an unparseable body. */
export async function fetchDirectory(endpoint: string): Promise<DirectoryFarm[]> {
  const res = await fetch(endpoint, { method: 'GET' })
  if (!res.ok) throw new Error(`directory request failed (${res.status})`)
  const body = (await res.json()) as { farms?: unknown }
  if (!Array.isArray(body?.farms)) throw new Error('directory response has no farms list')
  return body.farms.filter(isDirectoryFarm)
}

/**
 * Publish one farm address. The server re-reads it on the chain before
 * storing, so the response is advisory — `false` just means "try again on
 * the next sync" (the roster sync drops the address from its done-set).
 */
export async function publishFarm(endpoint: string, farmAddress: string): Promise<boolean> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ farm: farmAddress }),
  })
  return res.ok
}
