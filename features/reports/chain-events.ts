/**
 * features/reports/chain-events.ts — On-chain report → scouting log row.
 *
 * The log UI renders `ScoutEvent`s (the shape seed data already uses). A
 * decoded `ScoutReport` has no confidence score, field name or transaction
 * signature, so the mapping is explicit about what is real:
 *
 *   diagnosis  ← aiLabel (the classifier output stored on-chain)
 *   notes      ← uri     (the photo the hash anchors)
 *   timestamp  ← the program's own clock reading, in the unit the log
 *                derives seasons from
 *   txSig      ← the report account address (the row's on-chain identity)
 *   chainStatus← raw status, rendered as a status pill instead of confidence
 *
 * `plant` is deliberately absent: the model's plant identity is display-only
 * (see `ScoutEvent.plant`) and the account has nowhere to store it, so a row
 * read without its local counterpart claims no plant.
 */

import type { ScoutEvent } from '@/constants/data'
import type { Farm } from '@/features/farm/types'
import { fromE6, formatShortDate } from '@/lib/format'
import type { ChainReport } from './useReportsQuery'

export function reportToScoutEvent(report: ChainReport, farm: Pick<Farm, 'name'>): ScoutEvent {
  return {
    id: report.address,
    date: formatShortDate(report.timestamp),
    timestamp: report.timestamp,
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
 * fields (the chain stores no confidence, severity or plant identity), but
 * the chain wins wherever it is the source of truth: the review status, the
 * farm the report belongs to, and the timestamp — the program wrote that
 * with its own clock, which beats the capture device's. So an offline-cached
 * row adopts the freshest truth the moment a refetch reaches it — a
 * verified report never stays "pending" behind its optimistic copy.
 */
export function mergeLogEvents(local: ScoutEvent[], fetched: ScoutEvent[]): ScoutEvent[] {
  const fetchedById = new Map(fetched.map((event) => [event.id, event]))
  const out: ScoutEvent[] = []
  const seen = new Set<string>()
  for (const event of local) {
    const fresh = fetchedById.get(event.id)
    out.push(
      fresh
        ? {
            ...event,
            field: fresh.field,
            chainStatus: fresh.chainStatus,
            timestamp: fresh.timestamp ?? event.timestamp,
          }
        : event,
    )
    seen.add(event.id)
  }
  for (const event of fetched) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    out.push(event)
  }
  return out
}
