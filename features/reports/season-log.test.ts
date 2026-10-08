/**
 * season-log.test.ts — folding the scouting log into season sections.
 *
 * The contract under test: seasons are DERIVED per row (from that row's own
 * coordinates and timestamp, never inherited), sections come back
 * newest-season-first, nothing is ever dropped (rows that cannot be placed
 * collect under `undated`, last), and an empty log invents no sections.
 */

import { describe, expect, it } from 'vitest'
import { groupLogBySeason, shouldLabelSeasons, type SeasonalRecord } from './season-log'

/** North Dakota — temperate northern hemisphere: four calendar seasons. */
const TEMPERATE = { lat: 46.8821, lng: -98.7023 }
/** Coastal West Africa — northern tropics: rainy / harmattan only. */
const TROPICAL = { lat: 5.6, lng: -0.2 }

function row(id: string, at: Date, coords: { lat: number; lng: number } = TEMPERATE): SeasonalRecord & { id: string } {
  return { id, timestamp: Math.floor(at.getTime() / 1000), ...coords }
}

describe('groupLogBySeason', () => {
  it('returns no sections for an empty log — the screen owns its empty state', () => {
    expect(groupLogBySeason([])).toEqual([])
  })

  it('puts every row of one season in a single section, in the log’s own order', () => {
    const sections = groupLogBySeason([row('a', new Date(2026, 6, 15)), row('b', new Date(2026, 7, 2))])

    expect(sections).toHaveLength(1)
    expect(sections[0].season).toEqual({ name: 'summer', year: 2026 })
    expect(sections[0].key).toBe('2026-summer')
    // Re-grouped, not re-sorted: input order survives inside a section.
    expect(sections[0].items.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('orders sections newest season first, whatever order the log arrived in', () => {
    const sections = groupLogBySeason([
      row('winter', new Date(2026, 0, 15)),
      row('summer', new Date(2026, 6, 15)),
      row('spring', new Date(2026, 3, 15)),
    ])

    expect(sections.map((s) => s.season?.name)).toEqual(['summer', 'spring', 'winter'])
    expect(sections.every((s) => s.season?.year === 2026)).toBe(true)
  })

  it('ages a section by its NEWEST row, not by whichever row arrived first', () => {
    // Winter spans the year boundary, so this section's first row (January)
    // is older than autumn's only row (November) while its newest (December)
    // is newer — sorting by first arrival would name the wrong season first.
    const sections = groupLogBySeason([
      row('winter-jan', new Date(2026, 0, 5)),
      row('autumn-nov', new Date(2026, 10, 10)),
      row('winter-dec', new Date(2026, 11, 20)),
    ])

    expect(sections.map((s) => s.key)).toEqual(['2026-winter', '2026-autumn'])
    expect(sections[0].items.map((r) => r.id)).toEqual(['winter-jan', 'winter-dec'])
  })

  it('keeps the year with the season — the same season name in two years is two records', () => {
    const sections = groupLogBySeason([row('y25', new Date(2025, 6, 15)), row('y26', new Date(2026, 6, 15))])

    expect(sections.map((s) => s.key)).toEqual(['2026-summer', '2025-summer'])
  })

  it('derives each row from its OWN coordinates — a tropical row never joins a temperate one', () => {
    const sections = groupLogBySeason([
      // Same calendar month (July 2026), same instant: two different climates.
      row('tropics', new Date(2026, 6, 15), TROPICAL),
      row('temperate', new Date(2026, 6, 15), TEMPERATE),
    ])

    expect(sections.map((s) => s.season?.name).sort()).toEqual(['rainy', 'summer'])
    expect(
      sections
        .flatMap((s) => s.items)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['temperate', 'tropics'])
  })

  it('reads harmattan off the calendar in the northern tropics', () => {
    const sections = groupLogBySeason([row('dust', new Date(2026, 0, 15), TROPICAL)])

    expect(sections[0].season).toEqual({ name: 'harmattan', year: 2026 })
  })

  it('never drops a row it cannot place — undated collects last, unlabelled', () => {
    const sections = groupLogBySeason([
      row('seasonless', new Date(2026, 6, 15)),
      // Written before `timestamp` existed: no claim on recency, still present.
      { id: 'legacy', lat: TEMPERATE.lat, lng: TEMPERATE.lng },
    ])

    expect(sections.map((s) => s.key)).toEqual(['2026-summer', 'undated'])
    const undated = sections[1]
    expect(undated.season).toBeNull()
    expect(undated.items.map((r) => r.id)).toEqual(['legacy'])
  })

  it('sends unusable coordinates to undated rather than guessing a climate band', () => {
    const sections = groupLogBySeason([
      row('impossible', new Date(2026, 6, 15), { lat: 120, lng: 0 }),
      row('not-a-number', new Date(2026, 6, 15), { lat: Number.NaN, lng: 0 }),
      row('ok', new Date(2026, 6, 15)),
    ])

    expect(sections).toHaveLength(2)
    expect(sections[1].key).toBe('undated')
    expect(sections[1].items.map((r) => r.id)).toEqual(['impossible', 'not-a-number'])
    expect(sections[0].items.map((r) => r.id)).toEqual(['ok'])
  })

  it('treats a non-finite timestamp as unplaceable instead of turning it into 1970', () => {
    const sections = groupLogBySeason([{ id: 'broken', timestamp: Number.NaN, ...TEMPERATE }])

    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe('undated')
  })
})

describe('shouldLabelSeasons', () => {
  it('is false for one section — a header over an all-one-season list says nothing', () => {
    const sections = groupLogBySeason([row('a', new Date(2026, 6, 15)), row('b', new Date(2026, 7, 2))])

    expect(shouldLabelSeasons(sections)).toBe(false)
  })

  it('is true once the log spans more than one season', () => {
    const sections = groupLogBySeason([row('a', new Date(2026, 6, 15)), row('b', new Date(2026, 0, 15))])

    expect(shouldLabelSeasons(sections)).toBe(true)
  })

  it('is false for a log of only undated rows — there is one group, unlabelled', () => {
    const sections = groupLogBySeason([{ id: 'legacy', lat: TEMPERATE.lat, lng: TEMPERATE.lng }])

    expect(sections).toHaveLength(1)
    expect(shouldLabelSeasons(sections)).toBe(false)
  })
})
