/**
 * lib/csv — farm record export
 *
 * The export has to survive a spreadsheet import: one header row, a stable
 * column count on every line and RFC 4180 quoting for values that contain
 * commas (escrow quantities are written like "45,200 bu").
 */

import { describe, expect, it } from 'vitest'
import { buildFarmRecordCsv, csvEscape, FARM_CSV_COLUMNS, farmRecordFileName, farmRecordRowCount } from '@/lib/csv'

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
  const csv = buildFarmRecordCsv(new Date(Date.UTC(2026, 8, 28)))

  it('starts with the full union header', () => {
    expect(csv.split('\n')[0]).toBe(FARM_CSV_COLUMNS.join(','))
  })

  it('contains one row per record (header excluded)', () => {
    const rows = csv.split('\n').slice(1)
    expect(rows).toHaveLength(farmRecordRowCount())
    expect(rows.filter((row) => row.startsWith('field,')).length).toBeGreaterThan(0)
    expect(rows.filter((row) => row.startsWith('scout_event,')).length).toBeGreaterThan(0)
    expect(rows.some((row) => row.startsWith('weather_policy,'))).toBe(true)
  })

  it('keeps every line at the same column count', () => {
    for (const line of csv.split('\n')) {
      expect(splitLine(line)).toHaveLength(FARM_CSV_COLUMNS.length)
    }
  })

  it('carries the seed record and quoted escrow quantity', () => {
    expect(csv).toContain('Clearwater Ridge Farm')
    expect(csv).toContain('"45,200 bu"')
    expect(csv).toContain('2026-09-28T')
    expect(csv).not.toContain('undefined')
  })

  it('suggests a spreadsheet-friendly file name', () => {
    const name = farmRecordFileName(new Date(Date.UTC(2026, 8, 28)))
    expect(name.startsWith('clearwater-ridge-farm-')).toBe(true)
    expect(name.endsWith('-2026-09-28.csv')).toBe(true)
  })
})
