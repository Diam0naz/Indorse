/**
 * scout-log.test.tsx — The device's scouting log
 *
 * ScoutLogProvider is what stops a capture from dying with the session:
 * every locally captured row persists to `indorse.scout.v1`, carries an
 * anchoring lifecycle, and is rewritable into its on-chain identity once
 * the outbox flush lands. Asserted here:
 *
 *   - a stored document hydrates on mount (captures survive a restart)
 *     and every change persists back — FIFO-capped so storage stays bounded;
 *   - `add` derives the lifecycle from what the capture actually carries:
 *     a chain row is anchored, an outbox payload queues, a bare row stays
 *     bare and promises nothing;
 *   - `markAnchored` rewrites the row as its report address and releases
 *     the payload; `markFailed` / `requeue` park and re-arm a row;
 *   - `reset` empties the log and the empty document (delete local data);
 *   - the default context (no provider — how screen tests render) reports
 *     ready + empty + no-op mutations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pressable, Text, View } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ScoutLogProvider, useScoutLog } from '@/components/scout-log-provider'
import type { ScoutEvent } from '@/constants/data'

const STORE_KEY = 'indorse.scout.v1'

/** A capture with a full outbox payload — the queued-path fixture. */
function capture(overrides: Partial<ScoutEvent> = {}): ScoutEvent {
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
    anchor: {
      photoHashHex: 'ab'.repeat(32),
      uri: 'indorse://scout/1000.jpg',
      aiLabel: 'Late blight',
      photoUris: ['file:///cache/shot.jpg'],
    },
    ...overrides,
  }
}

/** Renders the log's observable surface + buttons for every mutation. */
function Probe() {
  const { ready, events, add, markAnchored, markFailed, requeue, reset } = useScoutLog()
  return (
    <View>
      <Text testID="ready">{String(ready)}</Text>
      <Text testID="events">
        {events
          .map((event) => `${event.id}:${event.anchorStatus ?? 'bare'}:${event.anchor ? 'payload' : 'none'}`)
          .join(',')}
      </Text>
      <Pressable testID="addQueued" onPress={() => add(capture())} />
      <Pressable
        testID="addChainRow"
        onPress={() => add(capture({ id: 'CHAIN1', txSig: 'CHAIN1', chainStatus: 'pending', anchor: undefined }))}
      />
      <Pressable testID="addBare" onPress={() => add(capture({ anchor: undefined }))} />
      <Pressable
        testID="anchor"
        onPress={() => markAnchored('sc1000', { reportAddress: 'REPORT1', field: 'Green Valley' })}
      />
      <Pressable testID="fail" onPress={() => markFailed('sc1000')} />
      <Pressable testID="requeue" onPress={() => requeue('sc1000')} />
      <Pressable testID="resetAll" onPress={() => reset()} />
    </View>
  )
}

async function renderLog() {
  return render(
    <ScoutLogProvider>
      <Probe />
    </ScoutLogProvider>,
  )
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(async () => {
  await AsyncStorage.clear()
  vi.clearAllMocks()
})

describe('scout log — persistence', () => {
  it('hydrates a stored document and reports ready', async () => {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ events: [capture({ id: 'sc2000' })] }))

    const screen = await renderLog()

    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))
    expect(screen.getByTestId('events').props.children).toBe('sc2000:queued:payload')
  })

  it('persists an added capture back to AsyncStorage with its lifecycle', async () => {
    const screen = await renderLog()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addQueued'))

    expect(screen.getByTestId('events').props.children).toBe('sc1000:queued:payload')
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}') as {
        events: { id: string; anchorStatus: string; anchor: { photoHashHex: string } }[]
      }
      expect(doc.events[0].anchorStatus).toBe('queued')
      expect(doc.events[0].anchor.photoHashHex).toBe('ab'.repeat(32))
    })
  })

  it('derives the lifecycle from what the capture carries', async () => {
    const screen = await renderLog()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    // A chain row is already anchored; a bare row has nothing to anchor.
    await fireEvent.press(screen.getByTestId('addChainRow'))
    expect(screen.getByTestId('events').props.children).toContain('CHAIN1:anchored:none')

    await fireEvent.press(screen.getByTestId('addBare'))
    expect(screen.getByTestId('events').props.children).toContain('sc1000:bare:none')
  })
})

describe('scout log — anchoring lifecycle', () => {
  it('markAnchored rewrites the row as its on-chain identity and persists it', async () => {
    const screen = await renderLog()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addQueued'))
    await fireEvent.press(screen.getByTestId('anchor'))

    // New id, new tx, real farm name, review status pending, payload gone.
    expect(screen.getByTestId('events').props.children).toBe('REPORT1:anchored:none')

    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}') as {
        events: Record<string, unknown>[]
      }
      expect(doc.events[0]).toMatchObject({
        id: 'REPORT1',
        txSig: 'REPORT1',
        field: 'Green Valley',
        chainStatus: 'pending',
        anchorStatus: 'anchored',
      })
      expect(doc.events[0]).not.toHaveProperty('anchor')
    })
  })

  it('markFailed parks the row with its payload; requeue re-arms it', async () => {
    const screen = await renderLog()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addQueued'))
    await fireEvent.press(screen.getByTestId('fail'))
    // Failed keeps the payload — a retry still has something to send.
    expect(screen.getByTestId('events').props.children).toBe('sc1000:failed:payload')

    await fireEvent.press(screen.getByTestId('requeue'))
    expect(screen.getByTestId('events').props.children).toBe('sc1000:queued:payload')
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}') as {
        events: { anchorStatus: string }[]
      }
      expect(doc.events[0].anchorStatus).toBe('queued')
    })
  })
})

describe('scout log — bounds & reset', () => {
  it('caps the stored log at 200 rows on hydration, newest first', async () => {
    const overflow = Array.from({ length: 205 }, (_, index) =>
      capture({ id: `sc${index}`, anchor: undefined, anchorStatus: undefined }),
    )
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ events: overflow }))

    const screen = await renderLog()

    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))
    const rows = String(screen.getByTestId('events').props.children).split(',')
    expect(rows).toHaveLength(200)
    // Newest first: sc0 survived, the oldest five were dropped.
    expect(rows[0].startsWith('sc0:')).toBe(true)
    expect(rows[199].startsWith('sc199:')).toBe(true)
  })

  it('reset empties the log and persists the empty document', async () => {
    const screen = await renderLog()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addQueued'))
    await waitFor(() => expect(screen.getByTestId('events').props.children).toBe('sc1000:queued:payload'))

    await fireEvent.press(screen.getByTestId('resetAll'))
    expect(screen.getByTestId('events').props.children).toBe('')
    await waitFor(async () => {
      expect(JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}')).toEqual({ events: [] })
    })
  })
})

describe('scout log — default context (no provider)', () => {
  it('reports ready with no events and no-op mutations', async () => {
    function NoProvider() {
      const { ready, events, add } = useScoutLog()
      return (
        <View>
          <Text testID="ready">{String(ready)}</Text>
          <Text testID="count">{String(events.length)}</Text>
          <Pressable testID="add" onPress={() => add(capture())} />
        </View>
      )
    }

    const screen = await render(<NoProvider />)
    expect(screen.getByTestId('ready').props.children).toBe('true')
    expect(screen.getByTestId('count').props.children).toBe('0')

    // The no-op must not crash or write — and the count stays put.
    await fireEvent.press(screen.getByTestId('add'))
    expect(screen.getByTestId('count').props.children).toBe('0')
    expect(await AsyncStorage.getItem(STORE_KEY)).toBeNull()
  })
})
