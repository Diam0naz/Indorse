/**
 * components/settings-provider.tsx — Persisted app preferences
 *
 * Holds the three pref groups the settings screens edit (notifications,
 * security, network) in one AsyncStorage document, so a change anywhere is
 * picked up by every consumer — the notification sheet filters by category,
 * the profile masks balances, the wallet provider reconnects to the chosen
 * cluster.
 *
 * The default context value keeps components working without a provider
 * (tests, isolated renders).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { buildCluster, DEFAULT_CLUSTER } from '@/constants/app-config'
import type { SolanaCluster } from '@wallet-ui/react-native-kit'

export type ClusterId = 'mainnet' | 'devnet' | 'testnet' | 'localnet' | 'custom'
export type AutoLock = 'immediate' | '1' | '5' | '15' | 'never'

export interface NotificationPrefs {
  push: boolean
  badge: boolean
  diagnosis: boolean
  escrow: boolean
  weather: boolean
  system: boolean
  quiet: boolean
  quietFrom: number
  quietTo: number
}

export interface SecurityPrefs {
  confirmSignatures: boolean
  deviceUnlock: boolean
  biometrics: boolean
  hideBalances: boolean
  autoLock: AutoLock
}

export interface NetworkPrefs {
  cluster: ClusterId
  customRpc: string
}

export interface AppSettings {
  notifications: NotificationPrefs
  security: SecurityPrefs
  network: NetworkPrefs
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: {
    push: true,
    badge: true,
    diagnosis: true,
    escrow: true,
    weather: true,
    system: true,
    quiet: false,
    quietFrom: 22,
    quietTo: 6,
  },
  security: {
    confirmSignatures: true,
    deviceUnlock: true,
    biometrics: false,
    hideBalances: false,
    autoLock: '5',
  },
  network: { cluster: 'devnet', customRpc: '' },
}

interface SettingsValue extends AppSettings {
  setNotifications: (patch: Partial<NotificationPrefs>) => void
  setSecurity: (patch: Partial<SecurityPrefs>) => void
  setNetwork: (patch: Partial<NetworkPrefs>) => void
  /** Restore every preference to its default. */
  reset: () => void
}

const STORAGE_KEY = 'indorse.settings'

const SettingsContext = createContext<SettingsValue>({
  ...DEFAULT_SETTINGS,
  setNotifications: () => undefined,
  setSecurity: () => undefined,
  setNetwork: () => undefined,
  reset: () => undefined,
})

export function SettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !stored) return
        const parsed = JSON.parse(stored) as Partial<AppSettings>
        setSettings((prev) => ({
          notifications: { ...prev.notifications, ...parsed.notifications },
          security: { ...prev.security, ...parsed.security },
          network: { ...prev.network, ...parsed.network },
        }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((next: AppSettings) => {
    setSettings(next)
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined)
  }, [])

  const setNotifications = useCallback(
    (patch: Partial<NotificationPrefs>) =>
      setSettings((prev) => {
        const next = { ...prev, notifications: { ...prev.notifications, ...patch } }
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined)
        return next
      }),
    [],
  )

  const setSecurity = useCallback(
    (patch: Partial<SecurityPrefs>) =>
      setSettings((prev) => {
        const next = { ...prev, security: { ...prev.security, ...patch } }
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined)
        return next
      }),
    [],
  )

  const setNetwork = useCallback(
    (patch: Partial<NetworkPrefs>) =>
      setSettings((prev) => {
        const next = { ...prev, network: { ...prev.network, ...patch } }
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined)
        return next
      }),
    [],
  )

  const reset = useCallback(() => {
    persist(DEFAULT_SETTINGS)
  }, [persist])

  const value = useMemo<SettingsValue>(
    () => ({ ...settings, setNotifications, setSecurity, setNetwork, reset }),
    [settings, setNotifications, setSecurity, setNetwork, reset],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsValue {
  return useContext(SettingsContext)
}

/** Cluster descriptor for the wallet provider, derived from preferences. */
export function useCluster(): SolanaCluster {
  const { network } = useSettings()
  return useMemo(() => buildCluster(network), [network])
}

export { DEFAULT_CLUSTER }
