/**
 * features/wallet/mwaTransaction.ts — Bridge generated-client instructions to
 * the Mobile Wallet Adapter.
 *
 * Codama's instruction builders attach a `TransactionSigner` **object** to every
 * signer account (`AccountSignerMeta`). That fights the wallet-ui flow:
 * `wallet.sendTransactions` injects its own MWA-backed fee-payer signer and then
 * lets kit collect signers from the transaction message — and kit's
 * `deduplicateSigners` throws `SOLANA_ERROR__SIGNER__ADDRESS_CANNOT_HAVE_MULTIPLE_SIGNERS`
 * when two signers share an address without being structurally identical (it
 * compares `Function.toString()`). A no-op signer for the connected wallet would
 * collide with the wallet's real one at that same address.
 *
 * Every signer account the app sends *is* the connected wallet, which is also
 * the fee payer — so the signature is already covered. Dropping the signer
 * objects while keeping the signer **role** hands the wallet exactly the shape
 * it wants: the same plain `AccountMeta`s the previous hand-rolled builder
 * produced.
 */

import { createNoopSigner, type AccountMeta, type Instruction, type TransactionSigner } from '@solana/kit'
import { toAddress } from '@/lib/program'

/**
 * The connected wallet as a signer-shaped value, for the generated builders that
 * type signer accounts as `TransactionSigner`.
 *
 * The no-op signer never signs — `wallet.sendTransactions` supplies the real
 * signature through its own MWA fee payer.
 */
export function walletSigner(walletAddress: string): TransactionSigner {
  return createNoopSigner(toAddress(walletAddress))
}

/**
 * Strip the signer objects from an instruction's accounts so it can be handed to
 * `wallet.sendTransactions`. Roles are preserved, so the signer bit survives.
 */
export function toWalletInstruction(instruction: Instruction): Instruction {
  const accounts = (instruction.accounts ?? []).map((meta) => {
    if (!('signer' in meta)) return meta
    return { address: meta.address, role: meta.role } as AccountMeta
  })
  return { ...instruction, accounts } as Instruction
}
