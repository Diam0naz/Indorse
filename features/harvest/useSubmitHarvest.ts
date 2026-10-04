/**
 * useSubmitHarvest
 *
 * TanStack Query mutation for the `submit_harvest_batch` instruction:
 *
 *   1. Derive the batch PDA from ["batch", farm, u32(batchCount)]
 *   2. Build `submit_harvest_batch`                     (lib/generated/indorse)
 *   3. Send via the Mobile Wallet Adapter and invalidate `['indorse']`
 *
 * Returns the on-chain HarvestBatch PDA address on success — the batch an
 * escrow attaches to. `batchCount` is the farm's current count: the new
 * batch takes that index.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '../wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '../wallet/mwaTransaction'
import { getSubmitHarvestBatchInstruction } from '@/lib/generated/indorse'
import { batchPda, toAddress } from '@/lib/program'
import { toE6 } from '@/lib/format'
import { validateHarvestBatch } from './types'
import type { SubmitHarvestBatchInput } from './types'

export function useSubmitHarvest() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<SubmitHarvestBatchInput, string>({
    actionLabel: 'submit harvest batch',
    validate: validateHarvestBatch,
    action: async (input, address) => {
      const batch = await batchPda(input.farmAddress, input.batchCount)

      const ix = getSubmitHarvestBatchInstruction({
        farmer: walletSigner(address),
        farm: toAddress(input.farmAddress),
        batch,
        photoHash: Uint8Array.from(input.photoHash),
        uri: input.uri,
        latE6: toE6(input.lat),
        lngE6: toE6(input.lng),
        crop: input.crop.trim(),
        quantityKg: input.quantityKg,
        notes: input.notes.trim(),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return batch
    },
  })
}
