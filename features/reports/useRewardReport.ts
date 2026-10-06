/**
 * useRewardReport — claim the SKR payout on a verified scout report.
 *
 * `reward_report` carries no arguments and gates on nothing but the report's
 * own state: the program requires `status == Verified`, then transfers a
 * protocol-pinned amount from the reward vault to an account it asserts is
 * `report.reporter`'s, and flips the status to `Rewarded` so the vault can't
 * be drained twice. There is no signer gate — anyone may push the payout —
 * and the app calls it from the reporter's own row because that is who the
 * money lands on. The connected wallet signs as the *payer*, not as a
 * required authority.
 *
 * Neither reward account is derivable. `reward_vault` is a plain token
 * account, not an associated one, held by the `reward_authority` PDA, and
 * `reward_mint` is whatever mint the admin chose when funding it — neither
 * lives in `Config`. Both are discovered from the chain instead: every token
 * account the authority owns *is* the vault, and that vault names the mint.
 * A reporter who has never held the mint has no destination account yet, so
 * an idempotent create is prepended — the same `AccountNotInitialized` trap
 * the escrow hooks already work around.
 *
 * The reporter is read back from the report rather than taken from the row
 * the UI happens to be holding, so a stale local log can't send the payout
 * to the wrong account.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress, type Address } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction } from '@/features/wallet/mwaTransaction'
import { getRewardReportInstruction } from '@/lib/generated/indorse'
import { ataPda, buildCreateAtaInstruction, fetchAccount, rewardAuthorityPda, useProgramRpc } from '@/lib/program'
import type { ProgramRpc } from '@/lib/program'
import { validateRewardReport } from './types'
import type { ScoutReport } from './types'

/** SPL Token's program id — the owner filter and the rail the payout moves on. */
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

export function useRewardReport() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const rpc = useProgramRpc()

  return useWalletMutation<string, string>({
    actionLabel: 'claim report reward',
    validate: validateRewardReport,
    action: async (reportAddress, payer) => {
      const report = await fetchAccount<ScoutReport>(rpc, reportAddress, 'ScoutReport')
      if (!report) throw new Error('That report does not exist on chain.')
      // Both rejected states the program itself would refuse, named before the
      // wallet prompt so the failure reads as a status, not a simulation error.
      if (report.status === 'rewarded') throw new Error('That reward has already been claimed.')
      if (report.status !== 'verified') throw new Error('That report is not verified yet.')

      const rewardAuthority = await rewardAuthorityPda()
      const { vault, mint } = await resolveReward(rpc, rewardAuthority)
      const destination = await ataPda(report.reporter, mint)

      const rewardIx = getRewardReportInstruction({
        report: toAddress(reportAddress),
        rewardAuthority,
        rewardVault: vault,
        rewardMint: mint,
        reporterTokenAccount: destination,
      })
      // The reporter may never have held the mint — create idempotently so
      // Anchor doesn't reject a merely-unopened destination account.
      const ataIx = buildCreateAtaInstruction({
        payer,
        ata: destination,
        owner: report.reporter,
        mint,
      })

      await wallet.sendTransactions([toWalletInstruction(ataIx), toWalletInstruction(rewardIx)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return destination
    },
  })
}

interface RewardAccounts {
  /** The authority's token account — the source the program transfers from. */
  vault: Address
  /** The mint that account holds, which nothing stores as a field anywhere. */
  mint: Address
}

/**
 * The reward authority's token account is the vault, and it names the mint.
 * The authority is funded with one mint, so the first account is the vault —
 * and a report can't be claimed before it exists, which is the honest error
 * to surface when it doesn't. Exported for its own test: this is the only
 * piece of the claim that reads the chain rather than deriving from it.
 */
export async function resolveReward(rpc: ProgramRpc, authority: Address): Promise<RewardAccounts> {
  const accounts = await rpc
    .getTokenAccountsByOwner(authority, { programId: toAddress(TOKEN_PROGRAM_ID) }, { encoding: 'jsonParsed' })
    .send()
  const vault = accounts.value[0]
  if (!vault) throw new Error('The reward vault is not funded yet — seed it before claiming rewards.')
  return { vault: vault.pubkey, mint: vault.account.data.parsed.info.mint }
}
