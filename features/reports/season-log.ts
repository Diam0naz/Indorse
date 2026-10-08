/**
 * features/reports/season-log.ts — the scouting log, grouped by season
 *
 * A scouted plant is only meaningful with a WHEN attached: the same field
 * scouted in the rainy season and in the dry one is two different answers.
 * The log has always carried the when — `ScoutReport.timestamp` is written
 * by the program on every submit — and the farm's climate band is already
 * derived from coordinates by `features/farm/season.ts`, so grouping costs
 * neither a contract change nor a new account: it is a fold over rows that
 * already exist.
 *
 * Two rules keep it honest:
 *
 *   1. Season is DERIVED from where and when each observation was made
 *      (`seasonForLocation(lat, lng, at)`), never typed in and never
 *      inherited from a neighbouring row. The Profile tab's season row uses
 *      the same function, so the two can never disagree.
 *   2. A row that cannot be placed — no timestamp (written before the field
 *      existed) or unusable coordinates — keeps its place in the log under
 *      an `undated` section instead of being quietly dropped. An omitted
 *      record is worse than an unlabelled one.
 *
 * Sections come back newest-season-first (by the most recent observation
 * inside each), and rows inside a section keep the log's own order — this
 * re-groups the list, it does not re-sort it. The caller decides whether
 * headers earn their space: one section means grouping adds nothing, so
 * the log renders exactly as it did before.
 *
 * The record is generic over anything carrying `timestamp`/`lat`/`lng`, so
 * `ScoutEvent` and a decoded `ScoutReport` both drop straight in.
 */

import { seasonForLocation, type DerivedSeason } from '@/features/farm/season'

/** What this module needs from a row: when and where it was observed. */
export interface SeasonalRecord {
  /** Observation time, epoch SECONDS (the on-chain unit); absent = unplaceable. */
  timestamp?: number
  lat: number
  lng: number
}

export interface SeasonSection<T> {
  /** `2026-rainy` — stable across renders, safe as a React key. `undated` when unplaced. */
  key: string
  /** The derived season; `null` exactly for the undated section. */
  season: DerivedSeason | null
  /** Members in the log's own order. */
  items: T[]
}

/** Group key for a placed row — season name, not index, so re-derivation is stable. */
function keyOf(season: DerivedSeason): string {
  return `${season.year}-${season.name}`
}

/**
 * Fold a flat log into season sections. Returns `[]` for an empty log —
 * the caller already renders its own empty state, so this invents none.
 */
export function groupLogBySeason<T extends SeasonalRecord>(records: T[]): SeasonSection<T>[] {
  if (records.length === 0) return []

  const sections = new Map<string, SeasonSection<T>>()
  /** Newest observation per section — the sort key, so a season's age is its latest row. */
  const newest = new Map<string, number>()
  const undated: T[] = []

  for (const record of records) {
    // `at` is held as `number | null` so the narrowing survives past the
    // season call — the undated path is decided here, not inferred later.
    const at = typeof record.timestamp === 'number' && Number.isFinite(record.timestamp) ? record.timestamp : null
    const season =
      at !== null && Number.isFinite(record.lat) && Number.isFinite(record.lng)
        ? seasonForLocation(record.lat, record.lng, new Date(at * 1000))
        : null

    if (at === null || season === null) {
      undated.push(record)
      continue
    }

    const key = keyOf(season)
    const section = sections.get(key) ?? { key, season, items: [] }
    section.items.push(record)
    sections.set(key, section)
    if (at > (newest.get(key) ?? Number.NEGATIVE_INFINITY)) newest.set(key, at)
  }

  const ordered = [...sections.values()].sort((a, b) => (newest.get(b.key) ?? 0) - (newest.get(a.key) ?? 0))
  // Last, always: without a timestamp there is no honest claim on recency.
  if (undated.length > 0) ordered.push({ key: 'undated', season: null, items: undated })
  return ordered
}

/**
 * Whether section headers would carry information — one section means every
 * row shares a season (or none could be placed), and a header over a list
 * that is all one season is decoration.
 */
export function shouldLabelSeasons<T>(sections: SeasonSection<T>[]): boolean {
  return sections.length > 1
}
