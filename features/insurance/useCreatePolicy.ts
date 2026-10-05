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
 * Returns the new policy PDA on success. The transaction prepends an
 * idempotent create of the farmer's USDC ATA — a wallet that has never held
 * USDC has no account, and the chain rejects a missing one before ever
 * reaching the premium transfer; a balance below the premium still surfaces
 * as the mutation error.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { getCreatePolicyInstruction } from '@/lib/generated/indorse'
import { ataPda, buildCreateAtaInstruction, insuranceVaultPda, policyPda, toAddress } from '@/lib/program'
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

      const ix = getCreatePolicyInstruction({
        farmer: walletSigner(address),
        farm: toAddress(input.farmAddress),
        policy,
        insuranceVault,
        farmerUsdc,
        usdcMint: toAddress(mint),
        crop: input.crop.trim(),
        coverageUsdc: usdcToLamports(input.coverageUsdc),
        premiumUsdc: usdcToLamports(input.premiumUsdc),
        triggerThresholdMm: input.triggerThresholdMm,
        seasonStart: input.seasonStart,
        seasonEnd: input.seasonEnd,
      })
      const ataIx = buildCreateAtaInstruction({ payer: address, ata: farmerUsdc, owner: address, mint })
      await wallet.sendTransactions([toWalletInstruction(ataIx), toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return policy
    },
  })
}
