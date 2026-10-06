/**
 * components/register-farm-modal.test.tsx — acreage at registration
 *
 * The chain account stores no acreage, so this form is the only channel
 * the number has: typed acres reach the local registry as a number, a
 * blank field stays absent (the input is optional), and junk is refused
 * before anything saves. The wallet is stubbed disconnected, so every
 * path here is the local-save branch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FarmRegistryProvider } from './farm-registry-provider'
import { RegisterFarmModal } from './register-farm-modal'

vi.mock('@/features/farm/useRegisterFarm', () => ({
  useRegisterFarm: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  // Guest path — no wallet, so the form saves locally with no transaction.
  useMobileWalletSetup: () => ({ walletState: 'disconnected' }),
}))

vi.mock('@/features/scout/location', () => ({ getCurrentCoords: vi.fn() }))

const LOAD = { timeout: 3000 }

type View = Awaited<ReturnType<typeof render>>

interface StoredFarm {
  name?: string
  acres?: number
}

async function renderModal() {
  const onClose = vi.fn()
  const view = await render(
    <FarmRegistryProvider>
      <RegisterFarmModal onClose={onClose} />
    </FarmRegistryProvider>,
  )
  return { onClose, view }
}

async function typeText(view: View, label: string, value: string) {
  await act(async () => {
    await fireEvent.changeText(view.getByLabelText(label), value)
  })
}

async function submit(view: View) {
  await act(async () => {
    await fireEvent.press(view.getByLabelText('Create farm'))
  })
}

/** Valid name + coordinates, leaving the optional acres field untouched. */
async function fillBaseForm(view: View) {
  await typeText(view, 'Farm name', 'Green Valley')
  await typeText(view, 'Latitude', '34.052000')
  await typeText(view, 'Longitude', '-118.243000')
}

async function storedFarms(): Promise<StoredFarm[] | undefined> {
  const doc = JSON.parse((await AsyncStorage.getItem('indorse.farms.v1')) ?? '{}') as { farms?: StoredFarm[] }
  return doc.farms
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('register-farm-modal acreage', () => {
  it('saves typed acreage into the local registry', async () => {
    const { onClose, view } = await renderModal()
    await fillBaseForm(view)
    await typeText(view, 'Acres (optional)', '120')
    await submit(view)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    await waitFor(async () => {
      expect((await storedFarms())?.[0]?.acres).toBe(120)
    })
  })

  it('leaves acreage absent when the optional field stays blank', async () => {
    const { onClose, view } = await renderModal()
    await fillBaseForm(view)
    await submit(view)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const farms = await storedFarms()
    expect(farms?.[0]?.name).toBe('Green Valley')
    expect(farms?.[0]?.acres).toBeUndefined()
  })

  it('refuses junk acreage before anything saves', async () => {
    const { onClose, view } = await renderModal()
    await fillBaseForm(view)
    await typeText(view, 'Acres (optional)', 'lots')
    await submit(view)

    expect(await view.findByText('Acres must be greater than 0', {}, LOAD)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect((await storedFarms()) ?? []).toHaveLength(0)
  })
})
