/**
 * useSlashVerifier — governed slash: removes a member and forfeits their
 * bond to the program treasury.
 *
 * The destructive twin of `useReleaseVerifier` — same seat, same vault,
 * but the funds sweep into the treasury's USDC ATA instead of back to the
 * member. Phase 1 ships a *governed* slash only (no automatic economics
 * until real verifier behaviour exists to design against).
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { getSlashVerifierInstruction } from '@/lib/generated/indorse'
import { ataPda, configPda, treasuryPda, verifierSetPda } from '@/lib/program'
import { validateVerifierTarget } from './types'
import type { VerifierTargetValues } from './types'

export function useSlashVerifier() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<VerifierTargetValues, string>({
    actionLabel: 'slash verifier',
    validate: validateVerifierTarget,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      const target = toAddress(input.target.trim())
      const [config, verifierSet, treasury] = await Promise.all([configPda(), verifierSetPda(), treasuryPda()])
      const [bondVault, treasuryUsdc] = await Promise.all([ataPda(verifierSet, mint), ataPda(treasury, mint)])

      const ix = getSlashVerifierInstruction({
        authority: walletSigner(address),
        config,
        verifierSet,
        treasury,
        bondVault,
        treasuryUsdc,
        usdcMint: toAddress(mint),
        target,
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return treasuryUsdc
    },
  })
}
