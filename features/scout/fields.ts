/**
 * features/scout/fields.ts — Field status derivation for the scout tab.
 *
 * Two sources, one `Field` shape (defined in `constants/data` alongside the
 * seed data it also feeds):
 *
 *   buildFieldsFromReports  on-chain reports → pseudo-fields grouped on a
 *                           1-decimal (~11 km) lat/lng grid, since the chain
 *                           stores no field name. Risk comes from the
 *                           classifier label; rejected reports read clean.
 *   buildFieldsFromEvents   the seeded sample log (disconnected fallback) —
 *                           one field per event field, worst severity wins.
 *
 * Kept out of the screen so both the UI and the tests derive from the same
 * code path.
 */

import type { Field, ScoutEvent } from '@/constants/data'
import type { ChainReport } from '@/features/reports/useReportsQuery'
import { fromE6 } from '@/lib/format'

/** Map a severity word onto the 0–1 risk scale used by the risk bar. */
export function severityRisk(s: string): number {
  if (s === 'high') return 0.8
  if (s === 'medium') return 0.5
  if (s === 'low') return 0.2
  return 0.05
}

/** Buckets for the three status chips: alert ≥ 0.5, watch ≥ 0.2, else clean. */
export function fieldStatus(risk: number): Field['status'] {
  return risk >= 0.5 ? 'alert' : risk >= 0.2 ? 'watch' : 'clean'
}

/** Infer a severity word from an aiLabel string (heuristic). */
export function labelSeverity(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('no disease') || l.includes('none')) return 'none'
  if (l.includes('high')) return 'high'
  if (l.includes('medium')) return 'medium'
  if (l.includes('low')) return 'low'
  return 'medium'
}

/**
 * Build the Field list from on-chain reports.
 *
 * The chain stores coordinates, not field names, so unique pseudo-fields are
 * grouped on a rounded coordinate pair (1 decimal ≈ 11 km grid) and named
 * "${farmName} zone N" by discovery order. The worst risk seen in a zone
 * decides its status; a rejected report contributes a near-zero risk.
 */
export function buildFieldsFromReports(reports: ChainReport[], farmName: string): Field[] {
  const map = new Map<string, { risk: number; name: string }>()
  reports.forEach((r) => {
    const key = `${fromE6(r.latE6).toFixed(1)},${fromE6(r.lngE6).toFixed(1)}`
    const risk = r.status === 'rejected' ? 0.05 : severityRisk(labelSeverity(r.aiLabel))
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { risk, name: `${farmName} zone ${map.size + 1}` })
    } else if (risk > prev.risk) {
      map.set(key, { ...prev, risk })
    }
  })
  return Array.from(map.values()).map((v, i) => ({
    id: `cf${i}`,
    name: v.name,
    acres: 0,
    crop: '—',
    risk: v.risk,
    status: fieldStatus(v.risk),
  }))
}

/** Seed acres for the sample log's named fields (demo values). */
const SEED_FIELD_ACRES: Record<string, number> = {
  'North Quarter': 480,
  'River Bottom': 320,
  'South Bench': 560,
  'East Draw': 480,
}

/** Build the Field list from the seeded sample events (disconnected fallback). */
export function buildFieldsFromEvents(events: ScoutEvent[]): Field[] {
  const map = new Map<string, ScoutEvent>()
  for (const e of events) {
    const prev = map.get(e.field)
    if (!prev || severityRisk(e.severity) > severityRisk(prev.severity)) {
      map.set(e.field, e)
    }
  }
  return Array.from(map.entries()).map(([name, e], i) => ({
    id: `sf${i}`,
    name,
    acres: SEED_FIELD_ACRES[name] ?? 0,
    crop: e.crop,
    risk: severityRisk(e.severity),
    status: fieldStatus(severityRisk(e.severity)),
  }))
}
