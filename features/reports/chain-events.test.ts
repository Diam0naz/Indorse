/**
 * chain-events.test.ts — On-chain report rows and the optimistic merge.
 *
 * The scouting log renders a blend of two sources: locally stored rows
 * (captures, anchored-but-offline rows) and freshly fetched chain reports.
 * `mergeLogEvents` decides what a duplicate id renders as, and that choice
 * is the difference between an honest log and a stale one:
 *
 *   - dedupe by id, local order first, fetched-only rows appended;
 *   - a duplicate adopts the chain's truth (review status + farm name)
 *     while keeping the local row's richer display fields — the chain
 *     stores no confidence or severity, so dropping the local copy would
 *     blank the row;
 *   - so a verified report never stays "pending" behind its optimistic
 *     copy, and an offline-cached row shows the freshest truth available.
 */

import { describe, expect, it } from 'vitest'
import type { ScoutEvent } from '@/constants/data'
import { mergeLogEvents, reportToScoutEvent } from './chain-events'

function localEvent(overrides: Partial<ScoutEvent> = {}): ScoutEvent {
  return {
    id: 'sc1000',
    date: 'Oct 4',
    field: 'Unregistered area',
    crop: '—',
    diagnosis: 'Late blight',
    confidence: 0.91,
    severity: 'high',
    txSig: 'ab'.repeat(32),
    notes: 'Lesions on lower leaves.',
    images: 2,
    lat: 46.8821,
    lng: -98.7023,
    anchorStatus: 'anchored',
    ...overrides,
  }
}

function chainRow(overrides: Partial<ScoutEvent> = {}): ScoutEvent {
  return {
    id: 'Report111',
    date: 'Oct 4',
    field: 'Green Valley',
    crop: '—',
    diagnosis: 'Late blight',
    confidence: 0,
    severity: 'none',
    txSig: 'Report111',
    notes: 'indorse://scout/1.jpg',
    images: 2,
    lat: 46.8821,
    lng: -98.7023,
    chainStatus: 'pending',
    ...overrides,
  }
}

describe('mergeLogEvents', () => {
  it('keeps local order first and appends fetched-only rows, deduped by id', () => {
    const local = [localEvent({ id: 'sc1' }), localEvent({ id: 'sc2' })]
    const fetched = [chainRow({ id: 'Report1' }), localEvent({ id: 'sc1' })]

    const merged = mergeLogEvents(local, fetched)

    expect(merged.map((event) => event.id)).toEqual(['sc1', 'sc2', 'Report1'])
  })

  it('adopts chain truth for a duplicate id while keeping local display fields', () => {
    // The local copy arrived at submit time (optimistic, "pending"); the
    // refetch brings the review outcome and the farm the report belongs to.
    const local = localEvent({ id: 'Report1', chainStatus: 'pending' })
    const fetched = chainRow({ id: 'Report1', field: 'Ridge Farm', chainStatus: 'verified' })

    const merged = mergeLogEvents([local], [fetched])

    expect(merged).toHaveLength(1)
    const row = merged[0]
    // Chain wins where it is the source of truth…
    expect(row.chainStatus).toBe('verified')
    expect(row.field).toBe('Ridge Farm')
    // …local keeps what the chain never stores (richness, not freshness).
    expect(row.confidence).toBe(0.91)
    expect(row.severity).toBe('high')
    expect(row.notes).toBe('Lesions on lower leaves.')
  })

  it('passes local-only rows through untouched (offline queue & cache)', () => {
    const queued = localEvent({ id: 'sc9', anchorStatus: 'queued', chainStatus: undefined })

    const merged = mergeLogEvents([queued], [])

    expect(merged).toEqual([queued])
  })

  it('leaves fetched rows alone when no local copy exists', () => {
    const fetched = chainRow({ id: 'Report2' })

    const merged = mergeLogEvents([], [fetched])

    expect(merged).toEqual([fetched])
  })
})

describe('reportToScoutEvent', () => {
  it('maps the decoded chain row honestly — no invented confidence', () => {
    const event = reportToScoutEvent(
      {
        farm: 'Farm1',
        reporter: 'Wallet1',
        index: 0,
        photoHash: Array(32).fill(1),
        uri: 'indorse://scout/7.jpg',
        latE6: 46882100,
        lngE6: -98702300,
        aiLabel: 'Powdery mildew',
        status: 'verified',
        verifier: 'Verifier1',
        timestamp: 1712000000,
        bump: 255,
        address: 'Report3',
      },
      { name: 'Green Valley' },
    )

    expect(event.id).toBe('Report3')
    expect(event.txSig).toBe('Report3')
    expect(event.field).toBe('Green Valley')
    expect(event.diagnosis).toBe('Powdery mildew')
    expect(event.chainStatus).toBe('verified')
    // The chain has no probability — zero here means "not stored", not 0%.
    expect(event.confidence).toBe(0)
    expect(event.severity).toBe('none')
    expect(event.anchorStatus).toBeUndefined()
  })
})
