/**
 * useSetRoles — admin rotates the three roles stored on the config PDA.
 *
 * Self-referential by design: only the key stored as `config.admin` today
 * may rewrite it (and the verifier/oracle fields beside it). The rotation
 * lands in one transaction — no redeploy, which is the whole reason the
 * roles live in an account instead of a constant.
 *
 * All three values always go: the instruction rewrites the full role set,
 * so the console prefills the current values and only an edited field moves.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getSetRolesInstruction } from '@/lib/generated/indorse'
import { configPda } from '@/lib/program'
import { validateSetRoles } from './types'
import type { SetRolesValues } from './types'

export function useSetRoles() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<SetRolesValues, string>({
    actionLabel: 'rotate roles',
    validate: validateSetRoles,
    action: async (input, address) => {
      const config = await configPda()
      const ix = getSetRolesInstruction({
        authority: walletSigner(address),
        config,
        admin: toAddress(input.admin.trim()),
        verifier: toAddress(input.verifier.trim()),
        oracle: toAddress(input.oracle.trim()),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return config
    },
  })
}
