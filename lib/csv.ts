/**
 * lib/csv.ts — Farm record export
 *
 * Turns the on-chain farm record (farm details, fields, scout events,
 * escrow and the weather policy) into a single RFC 4180 style CSV: one
 * header row, one row per record, blank cells where a record type does not
 * use a column. That shape drops straight into Sheets/Excel or a pandas
 * `read_csv`.
 */

import { ESCROW, FARM, FIELDS, SCOUT_EVENTS, USER, WEATHER } from '@/constants/data'

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

export type FarmCsvSectionKey = 'farm' | 'fields' | 'events' | 'escrow' | 'weather'

/** Row counts per section, used by the export screen's contents summary. */
export function farmRecordSections(): { key: FarmCsvSectionKey; count: number }[] {
  return [
    { key: 'farm', count: 1 },
    { key: 'fields', count: FIELDS.length },
    { key: 'events', count: SCOUT_EVENTS.length },
    { key: 'escrow', count: 1 },
    { key: 'weather', count: 1 },
  ]
}

/** Record rows (header row not counted). */
export function farmRecordRowCount(): number {
  return 1 + FIELDS.length + SCOUT_EVENTS.length + 1 + 1
}

/** Build the full farm record CSV document (header + every record row). */
export function buildFarmRecordCsv(exportedAt: Date = new Date()): string {
  const rows: FarmCsvRow[] = [
    {
      record_type: 'farm',
      farm_name: FARM.name,
      operator: USER.name,
      season: FARM.season,
      location: FARM.location,
      total_acres: FARM.totalAcres,
      record_pda: FARM.recordPDA,
      exported_at: exportedAt.toISOString(),
    },
    ...FIELDS.map<FarmCsvRow>((field) => ({
      record_type: 'field',
      field_name: field.name,
      acres: field.acres,
      crop: field.crop,
      status: field.status,
      risk_pct: Math.round(field.risk * 100),
    })),
    ...SCOUT_EVENTS.map<FarmCsvRow>((event) => ({
      record_type: 'scout_event',
      event_date: event.date,
      diagnosis: event.diagnosis,
      confidence: event.confidence,
      severity: event.severity,
      images: event.images,
      latitude: event.lat,
      longitude: event.lng,
      tx_signature: event.txSig,
      notes: event.notes,
    })),
    {
      record_type: 'escrow',
      buyer: ESCROW.buyer,
      buyer_pubkey: ESCROW.buyerPubkey,
      commodity: ESCROW.commodity,
      quantity: ESCROW.quantity,
      total_value_usd: ESCROW.totalValue,
      escrow_pda: ESCROW.escrowPDA,
      provenance_score: ESCROW.provenanceScore,
    },
    {
      record_type: 'weather_policy',
      policy_id: WEATHER.policyId,
      coverage: WEATHER.coverage,
      trigger_period: WEATHER.triggerPeriod,
      premium_usd: WEATHER.premium,
      max_payout_usd: WEATHER.maxPayout,
      policy_status: WEATHER.status,
      rainfall_mm: WEATHER.totalRainfallMm / 10,
      trigger_mm: WEATHER.triggerThresholdMm / 10,
      precip_pct: Math.round((WEATHER.totalRainfallMm / WEATHER.normalRainfallMm) * 100),
      days_remaining: WEATHER.daysRemaining,
      last_update: WEATHER.lastUpdate,
    },
  ]

  return [FARM_CSV_COLUMNS.join(','), ...rows.map(toCsvLine)].join('\n')
}

/** Suggested file name, e.g. `clearwater-ridge-2026-09-28.csv`. */
export function farmRecordFileName(at: Date = new Date()): string {
  const slug = FARM.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const day = at.toISOString().slice(0, 10)
  return `${slug}-${FARM.season}-${day}.csv`
}
