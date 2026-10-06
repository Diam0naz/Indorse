/**
 * components/scout-log-provider.test.tsx — erasing one row
 *
 * `remove` is the row-level half of the local-wipe promise: the named row
 * leaves the store (and the disk copy with it), neighbours stay, and the
 * evidence files only that row referenced are handed to the stale-set
 * release — never a file a surviving row still points at.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoutEvent } from '@/constants/data'
import { releaseEvidence } from '@/features/scout/evidence'
import { ScoutLogProvider, useScoutLog } from './scout-log-provider'

vi.mock('@/features/scout/evidence', () => ({ releaseEvidence: vi.fn() }))

const makeWrapper = () => {
  function Wrapper({ children }: { children: ReactNode }) {
    return <ScoutLogProvider>{children}</ScoutLogProvider>
  }
  return Wrapper
}

function row(id: string, photoUris: string[] = []): ScoutEvent {
  return {
    id,
    date: 'Oct 6',
    field: 'Unregistered area',
    crop: '—',
    diagnosis: 'Late blight',
    confidence: 0.9,
    severity: 'high',
    txSig: 'ab'.repeat(32),
    notes: 'Lesions on lower leaves.',
    images: photoUris.length,
    lat: 46.8821,
    lng: -98.7023,
    photoUris,
    anchorStatus: 'queued',
  }
}

/** Mount a fresh provider against an empty store, ready to take writes. */
async function mountLog() {
  const { result } = await renderHook(() => useScoutLog(), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current?.ready).toBe(true))
  return result
}

beforeEach(async () => {
  await AsyncStorage.clear()
  vi.mocked(releaseEvidence).mockClear()
})

describe('scout-log-provider remove', () => {
  it('erases the row it names and leaves its neighbours alone', async () => {
    const result = await mountLog()

    await act(async () => {
      result.current.add(row('sc-a'))
      result.current.add(row('sc-b'))
    })
    // Newest first — the store's standing order.
    expect(result.current.events.map((event) => event.id)).toEqual(['sc-b', 'sc-a'])

    await act(async () => {
      result.current.remove('sc-a')
    })
    expect(result.current.events.map((event) => event.id)).toEqual(['sc-b'])

    // ...and the disk copy follows, not just the screen.
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem('indorse.scout.v1')) ?? '{}')
      expect(doc.events.map((event: ScoutEvent) => event.id)).toEqual(['sc-b'])
    })
  })

  it('releases the departed row’s evidence — and only that', async () => {
    const result = await mountLog()

    await act(async () => {
      result.current.add(row('sc-a', ['file:///evidence/aa.jpg']))
      result.current.add(row('sc-b', ['file:///evidence/bb.jpg']))
    })
    // The adopt pass has seen both files; while both rows live, nothing
    // is stale and no file may move.
    expect(vi.mocked(releaseEvidence)).not.toHaveBeenCalled()

    await act(async () => {
      result.current.remove('sc-a')
    })
    expect(vi.mocked(releaseEvidence)).toHaveBeenCalledWith(['file:///evidence/aa.jpg'], ['file:///evidence/bb.jpg'])
  })

  it('ignores an id the store never held', async () => {
    const result = await mountLog()

    await act(async () => {
      result.current.add(row('sc-only'))
    })
    await act(async () => {
      result.current.remove('sc-missing')
    })
    expect(result.current.events.map((event) => event.id)).toEqual(['sc-only'])
  })
})
