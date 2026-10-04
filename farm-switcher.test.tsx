/**
 * farm-switcher.test.tsx — The farm cards behind the header pill
 *
 * FarmSwitcherSheet is how a user with several farms picks which one the
 * shared pill (and through it every screen) features. Asserted here:
 *
 *   - every registry farm renders as a card: name, real coordinates,
 *     an on-chain/local badge and the report count when the chain knows it;
 *   - the current farm is the one marked selected;
 *   - tapping a card makes it current (the pill changes through the shared
 *     provider) and closes the sheet;
 *   - the empty registry gets an honest empty state, and the footer button
 *     reports the caller's add-farm intent instead of pretending to save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text, View } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { FarmRegistryProvider, useFarmRegistry } from '@/components/farm-registry-provider'
import { FarmSwitcherSheet } from '@/components/farm-switcher-sheet'

const STORE_KEY = 'indorse.farms.v1'

function CurrentProbe() {
  const { current } = useFarmRegistry()
  return <Text testID="current">{current ? current.name : 'none'}</Text>
}

interface HarnessProps {
  onClose?: () => void
  onAddFarm?: () => void
}

async function renderSheet({ onClose = vi.fn(), onAddFarm = vi.fn() }: HarnessProps = {}) {
  const screen = await render(
    <FarmRegistryProvider>
      <CurrentProbe />
      <FarmSwitcherSheet visible onClose={onClose} onAddFarm={onAddFarm} />
    </FarmRegistryProvider>,
  )
  return { screen, onClose, onAddFarm }
}

async function seed(farms: unknown[], currentId: string | null) {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ farms, currentId }))
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(async () => {
  await AsyncStorage.clear()
  vi.clearAllMocks()
})

describe('farm switcher — the cards', () => {
  it('lists every farm with its badge, coordinates and report count', async () => {
    await seed(
      [
        { id: 'local-1', name: 'Device Farm', lat: 9.9207, lng: -8.9444, source: 'local', addedAt: 1 },
        {
          id: 'Chain111',
          name: 'Chain Farm',
          lat: 46.8821,
          lng: -98.7023,
          source: 'chain',
          address: 'Chain111',
          reportCount: 7,
          addedAt: 2,
        },
      ],
      'local-1',
    )

    const { screen } = await renderSheet()

    expect((await screen.findAllByText('Device Farm')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Chain Farm')).length).toBeGreaterThan(0)
    // Real coordinates, not decoration (the chain card appends its address).
    expect(screen.getByText(/9\.9207, -8\.9444/)).toBeTruthy()
    expect(screen.getByText(/46\.8821, -98\.7023/)).toBeTruthy()
    // Badges: local vs on-chain.
    expect(screen.getByText('local')).toBeTruthy()
    expect(screen.getByText('on-chain')).toBeTruthy()
    // The chain entry carries its live report count.
    expect(screen.getByText('7 reports')).toBeTruthy()
    // The current farm is the selected card.
    expect(screen.getByRole('button', { selected: true })).toBeTruthy()
  })

  it('switches the current farm through the shared provider and closes', async () => {
    await seed(
      [
        { id: 'local-1', name: 'Device Farm', lat: 1, lng: 2, source: 'local', addedAt: 1 },
        { id: 'local-2', name: 'Second Farm', lat: 3, lng: 4, source: 'local', addedAt: 2 },
      ],
      'local-1',
    )

    const { screen, onClose } = await renderSheet()
    expect(screen.getByTestId('current').props.children).toBe('Device Farm')

    await fireEvent.press((await screen.findAllByText('Second Farm'))[0])

    await waitFor(() => expect(screen.getByTestId('current').props.children).toBe('Second Farm'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hands its Add farm button to the caller', async () => {
    const { screen, onClose, onAddFarm } = await renderSheet()

    await fireEvent.press(await screen.findByText('Add farm'))

    expect(onAddFarm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('farm switcher — empty registry', () => {
  it('shows an honest empty state instead of ghost cards', async () => {
    const { screen } = await renderSheet()

    expect(await screen.findByText('No farms yet')).toBeTruthy()
    expect(screen.getByText('Add your first farm — it becomes the farm every screen features.')).toBeTruthy()
    expect(screen.getByTestId('current').props.children).toBe('none')
  })
})
