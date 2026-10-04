/**
 * fields.test.ts — the scout tab's field derivation.
 *
 * The same functions back the field cards, the attention banner and the
 * screens tests, so their grouping and risk-bucketing rules are pinned here.
 */

import { describe, expect, it } from 'vitest'
import { buildFieldsFromEvents, buildFieldsFromReports, fieldStatus, labelSeverity, severityRisk } from './fields'
import { FIELDS, SCOUT_EVENTS } from '@/constants/data'
import type { ChainReport } from '@/features/reports/useReportsQuery'

describe('severityRisk / fieldStatus', () => {
  it('buckets severities onto the three statuses', () => {
    expect(severityRisk('high')).toBe(0.8)
    expect(severityRisk('medium')).toBe(0.5)
    expect(severityRisk('low')).toBe(0.2)
    expect(severityRisk('none')).toBe(0.05)

    expect(fieldStatus(0.8)).toBe('alert')
    expect(fieldStatus(0.5)).toBe('alert')
    expect(fieldStatus(0.31)).toBe('watch')
    expect(fieldStatus(0.05)).toBe('clean')
  })

  it('infers the severity word from a classifier label', () => {
    expect(labelSeverity('No disease detected')).toBe('none')
    expect(labelSeverity('High severity blight')).toBe('high')
    expect(labelSeverity('low vigor')).toBe('low')
    // Unknown labels default to medium — flagged, not ignored.
    expect(labelSeverity('Downy Mildew')).toBe('medium')
  })
})

describe('buildFieldsFromEvents', () => {
  const fields = buildFieldsFromEvents(SCOUT_EVENTS)
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))

  it('covers every seeded field exactly once', () => {
    expect(fields.map((f) => f.name).sort()).toEqual(FIELDS.map((f) => f.name).sort())
    expect(new Set(fields.map((f) => f.id)).size).toBe(fields.length)
  })

  it('translates the worst event severity into the status', () => {
    expect(byName['East Draw'].status).toBe('alert') // high
    expect(byName['River Bottom'].status).toBe('alert') // medium
    expect(byName['South Bench'].status).toBe('watch') // low
    expect(byName['North Quarter'].status).toBe('clean') // none
  })

  it('keeps the demo acreage and the event crop', () => {
    expect(byName['North Quarter'].acres).toBe(480)
    expect(byName['North Quarter'].crop).toBe('Winter Wheat')
    expect(byName['River Bottom'].crop).toBe('Corn')
  })
})

describe('buildFieldsFromReports', () => {
  // Reports store coordinates, not field names — grouping is on a 0.1° grid.
  const reports = [
    { latE6: 46_882_110, lngE6: -98_702_310, aiLabel: 'Downy Mildew', status: 'pending' },
    { latE6: 46_882_120, lngE6: -98_702_320, aiLabel: 'Powdery Mildew', status: 'verified' },
    { latE6: 46_882_130, lngE6: -98_702_330, aiLabel: 'No disease detected', status: 'verified' },
    { latE6: 34_000_000, lngE6: -98_000_000, aiLabel: 'High severity blight', status: 'rejected' },
  ] as ChainReport[]

  const fields = buildFieldsFromReports(reports, 'Green Valley')

  it('merges same-grid reports into one named zone', () => {
    expect(fields.map((f) => f.name)).toEqual(['Green Valley zone 1', 'Green Valley zone 2'])
    // The first three share a cell → one zone with the worst risk seen.
    expect(fields[0].risk).toBe(0.5) // medium default from the aiLabel
    expect(fields[0].status).toBe('alert')
    // No acreage/crop on-chain — the meta line hides for these.
    expect(fields[0].acres).toBe(0)
    expect(fields[0].crop).toBe('—')
  })

  it('reads a rejected report as clean regardless of the label', () => {
    expect(fields[1].status).toBe('clean')
    expect(fields[1].risk).toBe(0.05)
  })
})
