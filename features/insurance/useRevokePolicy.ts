/**
 * useRevokePolicy — farmer cancels an active policy before season end
 *
 * Sends `revoke_policy`, which:
 *
 *   1. Returns the premium from the policy vault to the farmer's USDC ATA
 *   2. Sweeps any treasury-funded coverage beyond it back to the treasury
 *   3. Closes the empty vault and the policy account — rents go to the farmer
 *
 * The policy + vault PDAs derive from ["policy"/"insurance_vault", farm,
 * u32(policyCount - 1)] — the most-recent policy, mirroring `usePolicyQuery`.
 * The program refuses once the season has ended (the policy must be settled
 * instead), and only the farmer recorded on the policy can sign.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { ADMIN_ADDRESS } from '@/constants/app-config'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { ataPda, buildInstruction, insuranceVaultPda, policyPda } from '@/lib/program'
import { validateRevokePolicy } from './types'
import type { RevokePolicyInput } from './types'

export function useRevokePolicy() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<RevokePolicyInput, string>({
    actionLabel: 'revoke policy',
    validate: validateRevokePolicy,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      // Policies are 0-indexed; the current one lives at policyCount - 1.
      const index = input.policyCount - 1
      const [policy, insuranceVault, farmerUsdc, insurerUsdc] = await Promise.all([
        policyPda(input.farmAddress, index),
        insuranceVaultPda(input.farmAddress, index),
        ataPda(address, mint),
        ataPda(ADMIN_ADDRESS, mint),
      ])

      const ix = buildInstruction('revoke_policy', {
        farmer: address,
        policy,
        insuranceVault,
        farmerUsdc,
        insurerUsdc,
      })
      await wallet.sendTransactions([ix])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return policy
    },
  })
}
