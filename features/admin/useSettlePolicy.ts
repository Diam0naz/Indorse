/**
 * useSettlePolicy — admin triggers settlement for a policy after season end.
 *
 * The program pays out of the policy's own vault: rainfall below the
 * threshold sends coverage to the farmer, otherwise it sweeps back to the
 * treasury. Unlike the farmer-side hooks this one needs a read first — the
 * weather-oracle PDA seeds from the policy's `seasonStart` and the payout
 * lands in the *policy farmer's* USDC account, so the console passes both
 * from the policy it already loaded.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { getSettlePolicyInstruction } from '@/lib/generated/indorse'
import { ataPda, insuranceVaultPda, policyPda, treasuryPda, weatherOraclePda } from '@/lib/program'
import { validateSettlePolicy } from './types'
import type { SettlePolicyValues } from './types'

export function useSettlePolicy() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<SettlePolicyValues, string>({
    actionLabel: 'settle policy',
    validate: validateSettlePolicy,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      const index = input.policyCount - 1
      const [policy, insuranceVault, oracle, treasury] = await Promise.all([
        policyPda(input.farmAddress, index),
        insuranceVaultPda(input.farmAddress, index),
        weatherOraclePda(input.farmAddress, input.seasonStart),
        treasuryPda(),
      ])
      const [farmerUsdc, insurerUsdc] = await Promise.all([ataPda(input.farmerAddress, mint), ataPda(treasury, mint)])

      const ix = getSettlePolicyInstruction({
        settler: walletSigner(address),
        policy,
        insuranceVault,
        oracle,
        farmerUsdc,
        treasury,
        insurerUsdc,
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return policy
    },
  })
}
