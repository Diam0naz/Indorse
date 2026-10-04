/**
 * useDeleteFarm — close the connected wallet's farm record on chain
 *
 * Sends `delete_farm`, which closes the farm PDA and returns its rent to
 * the owner. No client-side derivation is needed: the farm address is the
 * input, and the program re-checks it against the ["farm", owner] seeds of
 * the signing wallet, so only the wallet that registered the farm can pass.
 *
 * Child accounts — scout reports, harvest batches, policies — are left on
 * chain as evidence; deleting the farm does not erase the trail. On success
 * the caller drops the registry entry too, and `['indorse']` is invalidated
 * so every screen refetches (the farm read comes back empty).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getDeleteFarmInstruction } from '@/lib/generated/indorse'
import { toAddress } from '@/lib/program'

export function useDeleteFarm() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<string, string>({
    actionLabel: 'delete farm',
    action: async (farmAddress, address) => {
      const ix = getDeleteFarmInstruction({
        farm: toAddress(farmAddress),
        owner: walletSigner(address),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return farmAddress
    },
  })
}
