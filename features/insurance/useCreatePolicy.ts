/**
 * useCreatePolicy — underwrite a parametric weather policy for the farm
 *
 * Builds and sends `create_policy` through the Mobile Wallet Adapter:
 *
 *   1. Derive policy + insurance-vault PDAs from ["policy"/"insurance_vault",
 *      farm, u32(policyCount)] and the farmer's USDC associated token account
 *   2. Encode {crop, coverageUsdc, premiumUsdc, triggerThresholdMm,
 *      seasonStart, seasonEnd} — money as 6-decimal lamports, the threshold
 *      in mm × 10 (the program's unit)
 *   3. Send via the wallet and invalidate `['indorse']` so the weather
 *      screen refetches the new policy
 *
 * Returns the new policy PDA on success. The premium transfer needs an
 * existing USDC ATA with a balance — the chain's rejection surfaces as the
 * mutation error.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { buildInstruction, ataPda, insuranceVaultPda, policyPda } from '@/lib/program'
import { usdcToLamports } from '@/lib/format'
import { validateCreatePolicy } from './types'
import type { CreatePolicyInput } from './types'

export function useCreatePolicy() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<CreatePolicyInput, string>({
    actionLabel: 'create policy',
    validate: validateCreatePolicy,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      const [policy, insuranceVault, farmerUsdc] = await Promise.all([
        policyPda(input.farmAddress, input.policyCount),
        insuranceVaultPda(input.farmAddress, input.policyCount),
        ataPda(address, mint),
      ])

      const ix = buildInstruction(
        'create_policy',
        {
          farmer: address,
          farm: input.farmAddress,
          policy,
          insuranceVault,
          farmerUsdc,
          usdcMint: mint,
        },
        {
          crop: input.crop.trim(),
          coverageUsdc: usdcToLamports(input.coverageUsdc),
          premiumUsdc: usdcToLamports(input.premiumUsdc),
          triggerThresholdMm: input.triggerThresholdMm,
          seasonStart: input.seasonStart,
          seasonEnd: input.seasonEnd,
        },
      )
      await wallet.sendTransactions([ix])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return policy
    },
  })
}
