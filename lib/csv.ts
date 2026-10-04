/**
 * lib/csv.ts — Farm record export
 *
 * Turns the live farm record (the farm account, zone fields, scout reports,
 * the latest escrow and the weather policy) into a single RFC 4180 style
 * CSV: one header row, one row per record, blank cells where a record type
 * does not use a column — or where the chain stores no such value (acres,
 * commodity, confidence … stay empty and are never invented). That shape
 * drops straight into Sheets/Excel or a pandas `read_csv`.
 *
 * Every row derives from `FarmRecordInput`, which the export screen
 * assembles from the chain queries: no wallet or no farm → an honest
 * header-only document with zero rows.
 */

import type { Field } from '@/constants/data'
import { fromE6 } from '@/lib/format'

/* ── Input ────────────────────────────────────────────────────────────────── */

/** Structural slices of the chain records the export writes. */
export interface FarmRecordFarm {
  name: string
  owner: string
  latE6: number
  lngE6: number
  address?: string
}

export interface FarmRecordReport {
  /** Unix seconds. */
  timestamp: number
  latE6: number
  lngE6: number
  aiLabel: string
  /** Review status as the codec decodes it (verified / pending / …). */
  status: string
  /** The report PDA — the row's stable on-chain identity. */
  address: string
}

export interface FarmRecordEscrow {
  /** Buyer wallet address — the chain stores no display name. */
  buyer: string
  /** USDC lamports (6 decimals, so 45_200_000_000 = 45,200 USDC). */
  amountUsdc: number
  address?: string
}

export interface FarmRecordPolicy {
  coverageUsdc: number
  premiumUsdc: number
  /** Rainfall shortfall trigger in mm × 10. */
  triggerThresholdMm: number
  seasonStart: number
  seasonEnd: number
  state: string
  address?: string
}

export interface FarmRecordReading {
  totalRainfallMm: number
  readingTimestamp: number
}

export interface FarmRecordInput {
  farm: FarmRecordFarm | null
  /** Operator display name (profile); falls back to the farm owner. */
  operator: string
  reports: FarmRecordReport[]
  fields: Field[]
  escrow: FarmRecordEscrow | null
  policy: FarmRecordPolicy | null
  reading: FarmRecordReading | null
  exportedAt: Date
}

/* ── Schema ───────────────────────────────────────────────────────────────── */

/** Union of every column any record type writes, in export order. */
export const FARM_CSV_COLUMNS = [
  'record_type',
  // farm
  'farm_name',
  'operator',
  'season',
  'location',
  'total_acres',
  'record_pda',
  'exported_at',
  // field
  'field_name',
  'acres',
  'crop',
  'status',
  'risk_pct',
  // scout event
  'event_date',
  'diagnosis',
  'confidence',
  'severity',
  'images',
  'latitude',
  'longitude',
  'tx_signature',
  'notes',
  'report_pda',
  'report_status',
  // escrow
  'buyer',
  'buyer_pubkey',
  'commodity',
  'quantity',
  'total_value_usd',
  'escrow_pda',
  'provenance_score',
  // weather policy
  'policy_id',
  'coverage',
  'trigger_period',
  'premium_usd',
  'max_payout_usd',
  'policy_status',
  'rainfall_mm',
  'trigger_mm',
  'precip_pct',
  'days_remaining',
  'last_update',
] as const

export type FarmCsvColumn = (typeof FARM_CSV_COLUMNS)[number]

/** A row is a sparse map of column → value; missing columns export as empty. */
export type FarmCsvRow = Partial<Record<FarmCsvColumn, string | number>>

/* ── Rendering ────────────────────────────────────────────────────────────── */

/** RFC 4180: quote fields containing comma/quote/newline, double the quotes. */
export function csvEscape(value: string | number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function toCsvLine(row: FarmCsvRow): string {
  return FARM_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',')
}

const isoDay = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10)
const isoInstant = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString()

export type FarmCsvSectionKey = 'farm' | 'fields' | 'events' | 'escrow' | 'weather'

/** Row counts per section, used by the export screen's contents summary. */
export function farmRecordSections(input: FarmRecordInput): { key: FarmCsvSectionKey; count: number }[] {
  return [
    { key: 'farm', count: input.farm ? 1 : 0 },
    { key: 'fields', count: input.fields.length },
    { key: 'events', count: input.reports.length },
    { key: 'escrow', count: input.escrow ? 1 : 0 },
    { key: 'weather', count: input.policy ? 1 : 0 },
  ]
}

/** Record rows (header row not counted). */
export function farmRecordRowCount(input: FarmRecordInput): number {
  return farmRecordSections(input).reduce((total, section) => total + section.count, 0)
}

/** Build the full farm record CSV document (header + every record row). */
export function buildFarmRecordCsv(input: FarmRecordInput): string {
  const { farm, operator, reports, fields, escrow, policy, reading, exportedAt } = input
  const rows: FarmCsvRow[] = []

  if (farm) {
    rows.push({
      record_type: 'farm',
      farm_name: farm.name,
      operator: operator || farm.owner,
      season: policy ? String(new Date(policy.seasonStart * 1000).getUTCFullYear()) : '',
      location: `${fromE6(farm.latE6)}, ${fromE6(farm.lngE6)}`,
      // total_acres: the farm account stores no acreage — the cell stays
      // empty rather than carrying the old seed's invented number.
      record_pda: farm.address ?? '',
      exported_at: exportedAt.toISOString(),
    })
  }

  for (const field of fields) {
    rows.push({
      record_type: 'field',
      field_name: field.name,
      // Chain-derived zones carry no acreage/crop — the derivation's
      // placeholders (0 / '—') export as empty cells, not fake values.
      acres: field.acres > 0 ? field.acres : '',
      crop: field.crop === '—' ? '' : field.crop,
      status: field.status,
      risk_pct: Math.round(field.risk * 100),
    })
  }

  for (const report of reports) {
    rows.push({
      record_type: 'scout_event',
      event_date: isoDay(report.timestamp),
      diagnosis: report.aiLabel,
      // confidence / severity / images / notes: never stored on chain, and
      // an account read carries no transaction signature — all empty.
      latitude: fromE6(report.latE6),
      longitude: fromE6(report.lngE6),
      report_pda: report.address,
      report_status: report.status,
    })
  }

  if (escrow) {
    rows.push({
      record_type: 'escrow',
      // The chain stores no buyer display name, commodity or quantity on
      // this account — only the wallet and the locked amount.
      buyer_pubkey: escrow.buyer,
      total_value_usd: escrow.amountUsdc / 1e6,
      escrow_pda: escrow.address ?? '',
    })
  }

  if (policy) {
    const secondsLeft = policy.seasonEnd - exportedAt.getTime() / 1000
    rows.push({
      record_type: 'weather_policy',
      policy_id: policy.address ?? '',
      coverage: policy.coverageUsdc / 1e6,
      trigger_period: `${isoDay(policy.seasonStart)} to ${isoDay(policy.seasonEnd)}`,
      premium_usd: policy.premiumUsdc / 1e6,
      policy_status: policy.state,
      rainfall_mm: reading ? reading.totalRainfallMm / 10 : '',
      trigger_mm: policy.triggerThresholdMm / 10,
      days_remaining: Math.max(0, Math.ceil(secondsLeft / 86_400)),
      last_update: reading ? isoInstant(reading.readingTimestamp) : '',
      // max_payout / precip baseline: no such value on chain → empty.
    })
  }

  return [FARM_CSV_COLUMNS.join(','), ...rows.map(toCsvLine)].join('\n')
}

/** Suggested file name, e.g. `red-creek-farm-2026-09-28.csv`. */
export function farmRecordFileName(farmName: string | null, at: Date): string {
  const slug =
    farmName
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'farm-record'
  const day = at.toISOString().slice(0, 10)
  return `${slug}-${day}.csv`
}
