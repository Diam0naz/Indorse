/**
 * features/profile/useSetupSignals.ts — Live inputs for setup progress
 *
 * Folds every source the banner (and the wizard's final checklist) reads
 * into one `SetupSignals` object:
 *
 *   useProfile()          saved profile + "skip for now" flags
 *   useMobileWalletSetup  wallet connected
 *   useFarmQuery          farm registered on-chain
 *   useCameraPermissions  camera granted (expo-camera, no prompt)
 *   getLocationPermission location granted (no prompt, guarded)
 *
 * The camera/location checks never prompt — prompting belongs to wizard
 * step 4. Each hook already has a safe default (guest / disconnected), so
 * this works in any screen that mounts the standard providers, and in tests
 * that stub the wallet and farm reads.
 */

import { useEffect, useState } from 'react'
import { useCameraPermissions } from 'expo-camera'
import { useProfile } from '@/components/profile-provider'
import { useMobileWalletSetup } from '@/features/wallet'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { getLocationPermission } from '@/features/scout/location'
import type { SetupSignals } from './types'

export function useSetupSignals(): SetupSignals {
  const { profile, deferred } = useProfile()
  const { walletState } = useMobileWalletSetup()
  const { farm } = useFarmQuery()
  const [cameraPermission] = useCameraPermissions()
  const [locationGranted, setLocationGranted] = useState(false)

  useEffect(() => {
    let live = true
    void getLocationPermission().then((granted) => {
      if (live) setLocationGranted(granted)
    })
    return () => {
      live = false
    }
  }, [])

  return {
    profileSaved: profile !== null,
    walletConnected: walletState === 'connected',
    farmRegistered: farm !== null,
    accessGranted: (cameraPermission?.granted ?? false) && locationGranted,
    deferred,
  }
}
