/**
 * register-farm-modal.test.tsx — Registering a farm, honestly
 *
 * The modal gained three responsibilities beyond the form itself:
 *
 *   - it pads below the status bar (the user reported the header sitting
 *     under the notification shade on device);
 *   - "Use my location" fills the coordinates from one real GPS fix;
 *   - submitting saves to the local registry — on-chain with a wallet,
 *     on-device only without one, with the honest note that says so.
 *
 * The safe-area is mocked with a device-like inset so the top padding is a
 * deterministic assertion; the wallet hook is stateful so both the guest and
 * connected paths run; `useRegisterFarm` is mocked because the real hook
 * needs a MobileWalletProvider ancestor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { FarmRegistryProvider, useFarmRegistry } from '@/components/farm-registry-provider'
import { RegisterFarmModal } from '@/components/register-farm-modal'
import { getCurrentCoords } from '@/features/scout/location'
import { spacing } from '@/constants/theme'

const STORE_KEY = 'indorse.farms.v1'
const INSET_TOP = 59

const wallet = vi.hoisted(() => ({ state: 'disconnected' as string }))
const register = vi.hoisted(() => ({
  mutate: vi.fn(),
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    walletState: wallet.state,
    address: wallet.state === 'connected' ? 'Wallet111' : null,
    wallet: {},
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@/features/farm/useRegisterFarm', () => ({
  useRegisterFarm: () => ({
    mutate: register.mutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}))

vi.mock('@/features/scout/location', () => ({
  getCurrentCoords: vi.fn(async () => ({ lat: 9.9207, lng: -8.9444, accuracy: 12 })),
}))

function RegistryProbe() {
  const { farms, current } = useFarmRegistry()
  return (
    <View>
      <Text testID="farms">{farms.map((f) => `${f.name}:${f.source}:${f.address ?? '-'}`).join(',')}</Text>
      <Text testID="current">{current ? current.name : 'none'}</Text>
    </View>
  )
}

type Screen = Awaited<ReturnType<typeof render>>

async function renderModal(onClose: () => void = vi.fn()): Promise<{ screen: Screen; onClose: () => void }> {
  const screen = await render(
    <FarmRegistryProvider>
      <RegistryProbe />
      <RegisterFarmModal onClose={onClose} />
    </FarmRegistryProvider>,
  )
  return { screen, onClose }
}

async function fillForm(screen: Screen) {
  await fireEvent.changeText(screen.getByLabelText('Farm name'), 'Device Farm')
  await fireEvent.changeText(screen.getByLabelText('Latitude'), '9.9207')
  await fireEvent.changeText(screen.getByLabelText('Longitude'), '-8.9444')
}

beforeEach(async () => {
  await AsyncStorage.clear()
  wallet.state = 'disconnected'
  register.mutate.mockReset()
  vi.mocked(getCurrentCoords).mockClear()
  vi.mocked(getCurrentCoords).mockResolvedValue({ lat: 9.9207, lng: -8.9444, accuracy: 12 })
})

afterEach(async () => {
  await AsyncStorage.clear()
  vi.clearAllMocks()
})

describe('register farm — layout', () => {
  it('pads the header below the status bar', async () => {
    const { screen } = await renderModal()

    const title = screen.getByText('Register your farm')
    // The header wraps the title; its top padding clears the inset.
    const header = title.parent
    expect(header).toBeTruthy()
    const style = Array.isArray(header?.props.style) ? Object.assign({}, ...header!.props.style) : header?.props.style
    expect(style?.paddingTop).toBe(INSET_TOP + spacing.md)
  })
})

describe('register farm — automatic location', () => {
  it('fills both coordinate fields from one GPS fix', async () => {
    const { screen } = await renderModal()

    await fireEvent.press(screen.getByText('Use my location'))

    await waitFor(() => expect(screen.getByLabelText('Latitude').props.value).toBe('9.920700'))
    expect(screen.getByLabelText('Longitude').props.value).toBe('-8.944400')
    expect(getCurrentCoords).toHaveBeenCalledTimes(1)
  })

  it('reports a failed fix instead of filling invented coordinates', async () => {
    vi.mocked(getCurrentCoords).mockResolvedValue(null)
    const { screen } = await renderModal()

    await fireEvent.press(screen.getByText('Use my location'))

    await waitFor(() =>
      expect(screen.getByText('Could not get a location fix — enter the coordinates manually.')).toBeTruthy(),
    )
    expect(screen.getByLabelText('Latitude').props.value).toBe('')
  })
})

describe('register farm — guest save (no wallet)', () => {
  it('says the farm stays on this device and saves it locally', async () => {
    const onClose = vi.fn()
    const { screen } = await renderModal(onClose)

    expect(screen.getByText('No wallet connected — this farm will be saved on this device only.')).toBeTruthy()

    await fillForm(screen)
    await fireEvent.press(screen.getByText('Create farm'))

    await waitFor(() => expect(screen.getByTestId('farms').props.children).toBe('Device Farm:local:-'))
    expect(screen.getByTestId('current').props.children).toBe('Device Farm')
    expect(register.mutate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)

    // …and it is written to the device store.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(STORE_KEY)
      expect(raw).toContain('Device Farm')
    })
  })
})

describe('register farm — connected save', () => {
  it('registers on-chain and records the PDA-backed farm', async () => {
    wallet.state = 'connected'
    register.mutate.mockImplementation((_input, cbs: { onSuccess?: (a: string) => void }) => {
      cbs?.onSuccess?.('FarmPDA111')
    })
    const onClose = vi.fn()
    const { screen } = await renderModal(onClose)

    expect(screen.queryByText('No wallet connected — this farm will be saved on this device only.')).toBeNull()

    await fillForm(screen)
    await fireEvent.press(screen.getByText('Create farm'))

    await waitFor(() => expect(screen.getByTestId('farms').props.children).toBe('Device Farm:chain:FarmPDA111'))
    expect(register.mutate).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
