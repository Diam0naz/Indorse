/**
 * useRegisterFarm
 *
 * TanStack Query mutation hook that builds and sends a `register_farm`
 * transaction via the Mobile Wallet Adapter:
 *
 *   1. Read the wallet's roster counter                 (["farm_counter", owner])
 *      — absent → this wallet's first farm (index 0)
 *   2. Derive the next farm PDA                         (["farm", owner, u32(index)])
 *      and preflight-read it: a hit means allocator/chain desync, which
 *      would fail `init` with System's opaque "already in use" — read
 *      first and fail with the real reason before the wallet prompt opens
 *   3. Build the `register_farm` instruction            (lib/generated/indorse)
 *   4. Send the kit instruction through the wallet      (sendTransactions)
 *   5. Invalidate the farm/reports queries and feature the new farm in
 *      the registry pill so the roster shows what was just added
 *
 * Returns the on-chain farm PDA address on success.
 *
 * Usage:
 *   const { mutate, isPending, isError, error } = useRegisterFarm()
 *   mutate({ name: 'Green Valley', lat: 34.052, lng: -118.243 })
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { TransactionError, useWalletMutation } from '../wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '../wallet/mwaTransaction'
import { validateRegisterFarm } from './types'
import { getRegisterFarmInstruction } from '@/lib/generated/indorse'
import { farmCounterPda, farmPda, fetchAccount, useProgramRpc } from '@/lib/program'
import { toE6 } from '@/lib/format'
import type { Farm, FarmCounter } from './types'
import type { RegisterFarmInput } from './types'

export function useRegisterFarm() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const rpc = useProgramRpc()
  const { setCurrent } = useFarmRegistry()

  return useWalletMutation<RegisterFarmInput, string>({
    actionLabel: 'register farm',
    validate: validateRegisterFarm,
    action: async (input, address) => {
      // The next free roster slot — no counter yet means index 0.
      const counterAddress = await farmCounterPda(address)
      const counter = await fetchAccount<FarmCounter>(rpc, counterAddress, 'FarmCounter')
      const index = counter?.count ?? 0
      const farm = await farmPda(address, index)

      const existing = await fetchAccount<Farm>(rpc, farm, 'Farm')
      if (existing) {
        // Counter and chain disagree — the chain would reject `init` anyway;
        // say why in full rather than letting the wallet show a bare failure.
        throw new TransactionError(
          `Roster slot ${index} is already occupied on chain (${farm}) while the counter reads ${index}. Refusing to send a transaction the chain would reject.`,
        )
      }

      const ix = getRegisterFarmInstruction({
        owner: walletSigner(address),
        farmCounter: counterAddress,
        farm,
        name: input.name.trim(),
        latE6: toE6(input.lat),
        lngE6: toE6(input.lng),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      // The farm just joined the roster — feature it, like addFarm does.
      setCurrent(farm)
      return farm
    },
  })
}
