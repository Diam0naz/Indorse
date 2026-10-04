/**
 * features/reports/chain-events.ts — On-chain report → scouting log row.
 *
 * The log UI renders `ScoutEvent`s (the shape seed data already uses). A
 * decoded `ScoutReport` has no confidence score, field name or transaction
 * signature, so the mapping is explicit about what is real:
 *
 *   diagnosis  ← aiLabel (the classifier output stored on-chain)
 *   notes      ← uri     (the photo the hash anchors)
 *   txSig      ← the report account address (the row's on-chain identity)
 *   chainStatus← raw status, rendered as a status pill instead of confidence
 */

import type { ScoutEvent } from '@/constants/data'
import type { Farm } from '@/features/farm/types'
import { fromE6, formatShortDate } from '@/lib/format'
import type { ChainReport } from './useReportsQuery'

export function reportToScoutEvent(report: ChainReport, farm: Pick<Farm, 'name'>): ScoutEvent {
  return {
    id: report.address,
    date: formatShortDate(report.timestamp),
    field: farm.name,
    crop: '—',
    diagnosis: report.aiLabel,
    confidence: 0,
    severity: 'none',
    txSig: report.address,
    notes: report.uri,
    images: 1,
    lat: fromE6(report.latE6),
    lng: fromE6(report.lngE6),
    chainStatus: report.status,
  }
}

/**
 * Merge locally stored rows with freshly fetched ones, deduping by id.
 *
 * A local row that has since landed on-chain keeps its richer display
 * fields (the chain stores no confidence or severity), but the chain wins
 * wherever it is the source of truth: the review status and the farm the
 * report belongs to. So an offline-cached row adopts the freshest truth
 * the moment a refetch reaches it — a verified report never stays
 * "pending" behind its optimistic copy.
 */
export function mergeLogEvents(local: ScoutEvent[], fetched: ScoutEvent[]): ScoutEvent[] {
  const fetchedById = new Map(fetched.map((event) => [event.id, event]))
  const out: ScoutEvent[] = []
  const seen = new Set<string>()
  for (const event of local) {
    const fresh = fetchedById.get(event.id)
    out.push(fresh ? { ...event, field: fresh.field, chainStatus: fresh.chainStatus } : event)
    seen.add(event.id)
  }
  for (const event of fetched) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    out.push(event)
  }
  return out
}
