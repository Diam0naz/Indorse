/**
 * useReconfigureVerifierSet — admin rewrites the verifier set's rules
 * (quorum k + seat price for future joins).
 *
 * Governed, not frozen: `reconfigure_verifier_set` is the Phase 3A answer
 * to "the rules live in code". It never touches members or their recorded
 * stakes — only the two numbers new joins and future finalizations read.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getReconfigureVerifierSetInstruction } from '@/lib/generated/indorse'
import { configPda, verifierSetPda } from '@/lib/program'
import { toE6 } from '@/lib/format'
import { validateVerifierSet } from './types'
import type { VerifierSetValues } from './types'

export function useReconfigureVerifierSet() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<VerifierSetValues, string>({
    actionLabel: 'reconfigure verifier set',
    validate: validateVerifierSet,
    action: async (input, address) => {
      const [config, verifierSet] = await Promise.all([configPda(), verifierSetPda()])
      const ix = getReconfigureVerifierSetInstruction({
        authority: walletSigner(address),
        config,
        verifierSet,
        k: input.k,
        bondAmount: toE6(input.bondAmount),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return verifierSet
    },
  })
}
