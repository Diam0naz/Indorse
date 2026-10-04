/**
 * lib/program/use-program-rpc.ts — RPC client bound to the network preference.
 *
 * Reads follow the Settings → Network choice (devnet by default), independent
 * of any wallet connection, so the scouting log can be fetched as soon as an
 * address is known. Outside a SettingsProvider the default context value
 * (devnet) applies, which keeps tests and stories provider-light.
 */

import { useMemo } from 'react'
import { useSettings } from '@/components/settings-provider'
import { rpcUrl } from '@/constants/app-config'
import { createProgramRpc, type ProgramRpc } from './rpc'

/** The RPC endpoint URL for the current network preference (query keys). */
export function useRpcUrl(): string {
  const { network } = useSettings()
  return rpcUrl(network)
}

export function useProgramRpc(): ProgramRpc {
  const url = useRpcUrl()
  return useMemo(() => createProgramRpc(url), [url])
}
