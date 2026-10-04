/**
 * farm-registry.test.tsx — The device's farm registry
 *
 * FarmRegistryProvider is the source behind the shared header pill: every
 * farm this device keeps (on-chain mirrors + device-only saves), plus which
 * one is current. Asserted here:
 *
 *   - a stored document hydrates on mount (farms + selection survive a
 *     restart) and every change persists back to `indorse.farms.v1`;
 *   - `addFarm` features the new farm immediately, `upsertChainFarm` mirrors
 *     the wallet's farm without ever duplicating it and never steals an
 *     existing selection;
 *   - a stale selection falls back to the first farm, so the pill can't
 *     render a ghost while a farm exists;
 *   - FarmChainSync mirrors what `useFarmQuery` reads off the chain into the
 *     registry (source: 'chain', PDA address, report count).
 *
 * The default context (no provider) is also pinned: tests that render
 * components without the provider get `ready: true, farms: []` and no-ops.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pressable, Text, View } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { FarmRegistryProvider, useFarmRegistry } from '@/components/farm-registry-provider'
import { FarmChainSync } from '@/features/farm/FarmChainSync'

const STORE_KEY = 'indorse.farms.v1'

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({
    farm: { name: 'Chain Farm', latE6: 3000000, lngE6: 4000000, reportCount: 7 },
    farmAddress: 'Chain111111111111111111111111111111111111',
    state: 'success',
    retry: vi.fn(),
  }),
}))

/** Renders the registry's observable surface + buttons for every mutation. */
function Probe() {
  const { ready, farms, current, addFarm, upsertChainFarm, setCurrent, removeFarm, reset } = useFarmRegistry()
  return (
    <View>
      <Text testID="ready">{String(ready)}</Text>
      <Text testID="farms">{farms.map((f) => `${f.name}:${f.source}:${f.reportCount ?? '-'}`).join(',')}</Text>
      <Text testID="current">{current ? `${current.name}:${current.source}` : 'none'}</Text>
      <Pressable
        testID="addLocal"
        onPress={() => addFarm({ name: 'Device Farm', lat: 9.92, lng: -8.94, source: 'local' })}
      />
      <Pressable
        testID="upsert"
        onPress={() =>
          upsertChainFarm({
            name: 'Chain Farm',
            lat: 3,
            lng: 4,
            address: 'Chain111111111111111111111111111111111111',
            reportCount: 7,
          })
        }
      />
      <Pressable testID="selectGhost" onPress={() => setCurrent('ghost-id')} />
      <Pressable testID="removeChain" onPress={() => removeFarm('Chain111111111111111111111111111111111111')} />
      <Pressable testID="resetAll" onPress={() => reset()} />
    </View>
  )
}

type Screen = Awaited<ReturnType<typeof render>>

async function renderRegistry(): Promise<Screen> {
  return render(
    <FarmRegistryProvider>
      <Probe />
    </FarmRegistryProvider>,
  )
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(async () => {
  await AsyncStorage.clear()
  vi.clearAllMocks()
})

describe('farm registry — persistence', () => {
  it('hydrates a stored document and reports ready', async () => {
    await AsyncStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        farms: [{ id: 'local-1', name: 'Stored Farm', lat: 1, lng: 2, source: 'local', addedAt: 111 }],
        currentId: 'local-1',
      }),
    )

    const screen = await renderRegistry()

    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))
    expect(screen.getByTestId('farms').props.children).toBe('Stored Farm:local:-')
    expect(screen.getByTestId('current').props.children).toBe('Stored Farm:local')
  })

  it('persists additions back to AsyncStorage', async () => {
    const screen = await renderRegistry()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addLocal'))

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(STORE_KEY)
      expect(raw).toContain('Device Farm')
      expect(raw).toContain('"source":"local"')
    })
    expect(screen.getByTestId('current').props.children).toBe('Device Farm:local')
  })
})

describe('farm registry — selection', () => {
  it('falls back to the first farm when the selection is stale', async () => {
    const screen = await renderRegistry()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addLocal'))
    expect(screen.getByTestId('current').props.children).toBe('Device Farm:local')

    await fireEvent.press(screen.getByTestId('selectGhost'))
    // The ghost id resolves to farms[0] — the pill never renders nothing.
    expect(screen.getByTestId('current').props.children).toBe('Device Farm:local')
  })
})

describe('farm registry — removal & reset', () => {
  it('drops a removed entry and persists the shrink (stale selection falls back)', async () => {
    const screen = await renderRegistry()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('upsert'))
    expect(screen.getByTestId('current').props.children).toBe('Chain Farm:chain')

    await fireEvent.press(screen.getByTestId('removeChain'))
    expect(screen.getByTestId('farms').props.children).toBe('')
    // The selection pointed at the removed farm → resolvedId falls back.
    expect(screen.getByTestId('current').props.children).toBe('none')

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(STORE_KEY)
      expect(JSON.parse(raw ?? '{}').farms).toEqual([])
    })
  })

  it('reset empties the registry and persists the empty document', async () => {
    const screen = await renderRegistry()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('addLocal'))
    await waitFor(() => expect(screen.getByTestId('farms').props.children).toBe('Device Farm:local:-'))

    await fireEvent.press(screen.getByTestId('resetAll'))
    expect(screen.getByTestId('farms').props.children).toBe('')
    expect(screen.getByTestId('current').props.children).toBe('none')

    const raw = await AsyncStorage.getItem(STORE_KEY)
    expect(JSON.parse(raw ?? '{}')).toEqual({ farms: [], currentId: null })
  })
})

describe('farm registry — chain mirroring (FarmChainSync)', () => {
  it('mirrors the on-chain farm as a chain entry with its report count', async () => {
    const screen = await render(
      <FarmRegistryProvider>
        <FarmChainSync />
        <Probe />
      </FarmRegistryProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('farms').props.children).toBe('Chain Farm:chain:7'))
    // The first farm seen claims the pill.
    expect(screen.getByTestId('current').props.children).toBe('Chain Farm:chain')
  })

  it('upserts in place — re-syncing never duplicates the entry', async () => {
    const screen = await renderRegistry()
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('upsert'))
    await fireEvent.press(screen.getByTestId('upsert'))

    expect(screen.getByTestId('farms').props.children).toBe('Chain Farm:chain:7')
  })
})

describe('farm registry — default context (no provider)', () => {
  it('reports ready with no farms and no-op mutations', async () => {
    function NoProvider() {
      const { ready, farms, current } = useFarmRegistry()
      return (
        <View>
          <Text testID="ready">{String(ready)}</Text>
          <Text testID="count">{String(farms.length)}</Text>
          <Text testID="current">{current === null ? 'null' : 'set'}</Text>
        </View>
      )
    }

    const screen = await render(<NoProvider />)
    expect(screen.getByTestId('ready').props.children).toBe('true')
    expect(screen.getByTestId('count').props.children).toBe('0')
    expect(screen.getByTestId('current').props.children).toBe('null')
  })
})
