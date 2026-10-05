/**
 * useRegisterFarm
 *
 * TanStack Query mutation hook that builds and sends a `register_farm`
 * transaction via the Mobile Wallet Adapter:
 *
 *   1. Derive the farm PDA from ["farm", owner]            (lib/program/pdas)
 *   2. Preflight-read the PDA — one farm per wallet, so an existing account
 *      fails `init` with System's opaque "already in use" (custom 0x0) that
 *      the wallet can only show as a failed simulation; read first and fail
 *      with the real reason before the wallet prompt opens
 *   3. Build the `register_farm` instruction               (lib/generated/indorse)
 *   4. Send the kit instruction through the wallet         (sendTransactions)
 *   5. Invalidate the farm/reports queries so the screen refetches
 *
 * Returns the on-chain farm PDA address on success.
 *
 * Usage:
 *   const { mutate, isPending, isError, error } = useRegisterFarm()
 *   mutate({ name: 'Green Valley', lat: 34.052, lng: -118.243 })
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { TransactionError, useWalletMutation } from '../wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '../wallet/mwaTransaction'
import { validateRegisterFarm } from './types'
import { getRegisterFarmInstruction } from '@/lib/generated/indorse'
import { farmPda, fetchAccount, useProgramRpc } from '@/lib/program'
import { toE6 } from '@/lib/format'
import type { Farm } from './types'
import type { RegisterFarmInput } from './types'

export function useRegisterFarm() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const rpc = useProgramRpc()

  return useWalletMutation<RegisterFarmInput, string>({
    actionLabel: 'register farm',
    validate: validateRegisterFarm,
    action: async (input, address) => {
      const farm = await farmPda(address)

      const existing = await fetchAccount<Farm>(rpc, farm, 'Farm')
      if (existing) {
        throw new TransactionError(
          `This wallet already owns the on-chain farm "${existing.name}" (${farm}). One farm per wallet — open it instead of registering a second.`,
        )
      }

      const ix = getRegisterFarmInstruction({
        owner: walletSigner(address),
        farm,
        name: input.name.trim(),
        latE6: toE6(input.lat),
        lngE6: toE6(input.lng),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return farm
    },
  })
}
