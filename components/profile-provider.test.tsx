/**
 * components/profile-provider.test.tsx — Setup wizard state
 *
 * Covers the three contract points the screens rely on:
 *   - the default context (no provider — how every other test renders)
 *     is `ready: true, profile: null` with inert writes;
 *   - saveProfile trims + persists to `indorse.profile.v1`;
 *   - deferStep flips a flag once, persists it, and a fresh provider
 *     re-hydrates both halves from storage.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ProfileProvider, useProfile } from './profile-provider'

const STORE_KEY = 'indorse.profile.v1'

function Probe() {
  const { ready, profile, deferred, saveProfile, deferStep, clearProfile } = useProfile()
  return (
    <>
      <Text testID="ready">{String(ready)}</Text>
      <Text testID="name">{profile?.name ?? 'none'}</Text>
      <Text testID="bio">{profile?.bio ?? 'none'}</Text>
      <Text testID="deferred-wallet">{String(deferred.wallet)}</Text>
      <Text
        testID="save"
        onPress={() => saveProfile({ name: '  Amina Otieno  ', bio: '  Cassava grower  ', photoUri: null })}
      >
        save
      </Text>
      <Text testID="defer" onPress={() => deferStep('wallet')}>
        defer
      </Text>
      <Text testID="clear" onPress={() => clearProfile()}>
        clear
      </Text>
    </>
  )
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('default context (no provider)', () => {
  it('reports a guest who has not set up, with inert writes', async () => {
    const screen = await render(<Probe />)

    expect(screen.getByTestId('ready').props.children).toBe('true')
    expect(screen.getByTestId('name').props.children).toBe('none')

    // Inert: no throw, no state change.
    await fireEvent.press(screen.getByTestId('save'))
    expect(screen.getByTestId('name').props.children).toBe('none')
  })
})

describe('ProfileProvider', () => {
  it('saves the step-1 profile, trimmed, to storage', async () => {
    const screen = await render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    )

    // Storage read settles → ready flips true (it starts false).
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('save'))
    await waitFor(() => expect(screen.getByTestId('name').props.children).toBe('Amina Otieno'))
    expect(screen.getByTestId('bio').props.children).toBe('Cassava grower')

    const stored = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}')
    expect(stored.profile.name).toBe('Amina Otieno')
    expect(stored.profile.bio).toBe('Cassava grower')
    expect(stored.deferred).toEqual({ wallet: false, farm: false, access: false, lock: false })
  })

  it('persists a deferred step so the banner counts it as handled', async () => {
    const screen = await render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('defer'))
    expect(screen.getByTestId('deferred-wallet').props.children).toBe('true')

    const stored = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}')
    expect(stored.deferred.wallet).toBe(true)
  })

  it('re-hydrates a stored profile and flags on the next launch', async () => {
    await AsyncStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        profile: { name: 'Mae Hollenbeck', bio: 'Cass farmer', photoUri: 'file:///doc/profile/avatar.jpg', savedAt: 1 },
        deferred: { wallet: true, farm: false, access: false, lock: false },
      }),
    )

    const screen = await render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))
    expect(screen.getByTestId('name').props.children).toBe('Mae Hollenbeck')
    expect(screen.getByTestId('bio').props.children).toBe('Cass farmer')
    expect(screen.getByTestId('deferred-wallet').props.children).toBe('true')
  })

  it('clearProfile empties the document in memory and in storage', async () => {
    const screen = await render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'))

    await fireEvent.press(screen.getByTestId('save'))
    await waitFor(() => expect(screen.getByTestId('name').props.children).toBe('Amina Otieno'))

    await fireEvent.press(screen.getByTestId('clear'))
    await waitFor(() => expect(screen.getByTestId('name').props.children).toBe('none'))
    expect(screen.getByTestId('deferred-wallet').props.children).toBe('false')

    // The stored document is the empty one — nothing left to re-hydrate.
    const stored = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}')
    expect(stored).toEqual({ profile: null, deferred: { wallet: false, farm: false, access: false, lock: false } })
  })
})
