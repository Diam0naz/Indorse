/**
 * useRegisterFarm
 *
 * TanStack Query mutation hook that builds and sends a `register_farm`
 * transaction via the Mobile Wallet Adapter:
 *
 *   1. Derive the farm PDA from ["farm", owner]            (lib/program/pdas)
 *   2. Build the `register_farm` instruction               (lib/generated/indorse)
 *   3. Send the kit instruction through the wallet         (sendTransactions)
 *   4. Invalidate the farm/reports queries so the screen refetches
 *
 * Returns the on-chain farm PDA address on success.
 *
 * Usage:
 *   const { mutate, isPending, isError, error } = useRegisterFarm()
 *   mutate({ name: 'Green Valley', lat: 34.052, lng: -118.243 })
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '../wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '../wallet/mwaTransaction'
import { validateRegisterFarm } from './types'
import { getRegisterFarmInstruction } from '@/lib/generated/indorse'
import { farmPda } from '@/lib/program'
import { toE6 } from '@/lib/format'
import type { RegisterFarmInput } from './types'

export function useRegisterFarm() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<RegisterFarmInput, string>({
    actionLabel: 'register farm',
    validate: validateRegisterFarm,
    action: async (input, address) => {
      const farm = await farmPda(address)
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
