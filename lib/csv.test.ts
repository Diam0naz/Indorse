/**
 * lib/csv — farm record export
 *
 * The export has to survive a spreadsheet import: one header row, a stable
 * column count on every line and RFC 4180 quoting for values that contain
 * commas (the GPS location column, written like "46.8821, -98.7023").
 * Every cell derives from the input fixture — the builder invents nothing
 * and leaves chain-unknown columns empty.
 */

import { describe, expect, it } from 'vitest'
import {
  buildFarmRecordCsv,
  csvEscape,
  FARM_CSV_COLUMNS,
  farmRecordFileName,
  farmRecordRowCount,
  type FarmCsvColumn,
  type FarmRecordInput,
} from '@/lib/csv'

/** Minimal RFC 4180 line splitter so column counts are checked honestly. */
function splitLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

const EXPORTED_AT = new Date(Date.UTC(2026, 8, 28))

const INPUT: FarmRecordInput = {
  farm: {
    name: 'Red Creek Farm',
    owner: 'Owner111111111111111111111111111111111111111',
    latE6: 46_882_100,
    lngE6: -98_702_300,
    address: 'Farm111111111111111111111111111111111111111',
  },
  operator: 'Mae Hollenbeck',
  reports: [
    {
      timestamp: 1_758_000_000,
      latE6: 46_882_110,
      lngE6: -98_702_310,
      aiLabel: 'Downy Mildew',
      status: 'verified',
      address: 'Report1111111111111111111111111111111111111',
    },
  ],
  fields: [{ id: 'z1', name: 'Red Creek Farm zone 1', acres: 0, crop: '—', status: 'alert', risk: 0.5 }],
  escrow: {
    buyer: 'Buyer111111111111111111111111111111111111111',
    amountUsdc: 45_200_000_000,
    address: 'Escrow1111111111111111111111111111111111111',
  },
  policy: {
    coverageUsdc: 5_000_000,
    premiumUsdc: 250_000,
    triggerThresholdMm: 500,
    seasonStart: Date.UTC(2026, 3, 1) / 1000,
    seasonEnd: Date.UTC(2026, 9, 15) / 1000,
    state: 'active',
    address: 'Policy1111111111111111111111111111111111111',
  },
  reading: { totalRainfallMm: 2_120, readingTimestamp: 1_758_100_000 },
  exportedAt: EXPORTED_AT,
}

const EMPTY: FarmRecordInput = {
  farm: null,
  operator: '',
  reports: [],
  fields: [],
  escrow: null,
  policy: null,
  reading: null,
  exportedAt: EXPORTED_AT,
}

describe('lib/csv escaping', () => {
  it('quotes values containing commas, quotes and newlines', () => {
    expect(csvEscape('45,200 bu')).toBe('"45,200 bu"')
    expect(csvEscape('a "quoted" value')).toBe('"a ""quoted"" value"')
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"')
  })

  it('leaves plain values and numbers untouched', () => {
    expect(csvEscape('Corn')).toBe('Corn')
    expect(csvEscape(78)).toBe('78')
    expect(csvEscape(undefined)).toBe('')
  })
})

describe('lib/csv document', () => {
  const csv = buildFarmRecordCsv(INPUT)

  it('starts with the full union header', () => {
    expect(csv.split('\n')[0]).toBe(FARM_CSV_COLUMNS.join(','))
  })

  it('contains one row per record (header excluded)', () => {
    const rows = csv.split('\n').slice(1)
    expect(rows).toHaveLength(farmRecordRowCount(INPUT))
    expect(rows.filter((row) => row.startsWith('field,')).length).toBeGreaterThan(0)
    expect(rows.filter((row) => row.startsWith('scout_event,')).length).toBeGreaterThan(0)
    expect(rows.some((row) => row.startsWith('weather_policy,'))).toBe(true)
  })

  it('keeps every line at the same column count', () => {
    for (const line of csv.split('\n')) {
      expect(splitLine(line)).toHaveLength(FARM_CSV_COLUMNS.length)
    }
  })

  it('carries the fixture values and quotes the GPS location', () => {
    expect(csv).toContain('Red Creek Farm')
    expect(csv).toContain('Mae Hollenbeck')
    // The location cell embeds a comma, so RFC 4180 quoting kicks in.
    expect(csv).toContain('"46.8821, -98.7023"')
    expect(csv).toContain('2026-09-28T')
    expect(csv).toContain('Report1111111111111111111111111111111111111')
    expect(csv).toContain('Downy Mildew')
    expect(csv).not.toContain('undefined')
  })

  it('leaves chain-unknown cells empty instead of inventing them', () => {
    const cell = (line: string, column: string): string => {
      const cells = splitLine(line)
      return cells[FARM_CSV_COLUMNS.indexOf(column as FarmCsvColumn)]
    }

    const event = csv.split('\n').filter((line) => line.startsWith('scout_event,'))[0]
    expect(cell(event, 'confidence')).toBe('')
    expect(cell(event, 'severity')).toBe('')
    expect(cell(event, 'tx_signature')).toBe('')
    expect(cell(event, 'report_status')).toBe('verified')

    const farm = csv.split('\n').filter((line) => line.startsWith('farm,'))[0]
    expect(cell(farm, 'total_acres')).toBe('')
    expect(cell(farm, 'operator')).toBe('Mae Hollenbeck')
  })

  it('exports an honest header-only document when there is no record', () => {
    expect(buildFarmRecordCsv(EMPTY).split('\n')).toHaveLength(1)
    expect(farmRecordRowCount(EMPTY)).toBe(0)
  })

  it('suggests a spreadsheet-friendly file name', () => {
    expect(farmRecordFileName('Red Creek Farm', EXPORTED_AT)).toBe('red-creek-farm-2026-09-28.csv')
    expect(farmRecordFileName(null, EXPORTED_AT)).toBe('farm-record-2026-09-28.csv')
  })
})
