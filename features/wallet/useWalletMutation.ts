/**
 * useWalletMutation
 *
 * Factory for TanStack Query mutations that send Solana transactions via
 * the Mobile Wallet Adapter. Collapses the boilerplate that every feature
 * hook previously copy-pasted:
 *
 *   1. Validate input → throw `Validation failed: <messages>`
 *   2. Require a connected wallet → throw `Wallet is not connected.`
 *   3. Extract the connected address (no repeated unsafe casts)
 *   4. Wrap low-level failures in TransactionError with a feature label
 */

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { describeErrors } from '@/lib/validation'

/** Thrown for any failure inside a wallet-backed mutation. */
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'TransactionError'
  }

  /**
   * The underlying reason, when it says something the label does not.
   * "Failed to create policy" alone is a dead end for the farmer — and for
   * whoever is trying to work out why the wallet bounced back.
   */
  get detail(): string | undefined {
    if (this.cause == null) return undefined
    const reason = this.cause instanceof Error ? this.cause.message : String(this.cause)
    const trimmed = reason.trim()
    if (!trimmed || trimmed === this.message) return undefined
    return trimmed
  }
}

/** Message plus underlying reason, for rendering in an error box. */
export function describeTransactionError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const detail = error instanceof TransactionError ? error.detail : undefined
  return detail ? `${error.message} — ${detail}` : error.message
}

/** Options accepted by the `useWalletMutation` factory. */
export interface UseWalletMutationOptions<TInput, TResult> {
  /**
   * Validate the input before touching the wallet. Return an error object
   * whose values are human-readable messages, or null when the input is clean.
   */
  validate?: (input: TInput) => object | null
  /** Build and send the transaction. `address` is the connected wallet address. */
  action: (input: TInput, address: string) => Promise<TResult>
  /** Label used when low-level errors are wrapped, e.g. "register farm". */
  actionLabel: string
}

export function useWalletMutation<TInput, TResult>(options: UseWalletMutationOptions<TInput, TResult>) {
  const { validate, action, actionLabel } = options
  const wallet = useMobileWallet()

  const mutationFn = useCallback(
    async (input: TInput): Promise<TResult> => {
      // 1. Validate input before touching the wallet
      if (validate) {
        const errors = validate(input)
        if (errors) {
          const messages = describeErrors(errors)
          if (messages) {
            throw new TransactionError(`Validation failed: ${messages}`)
          }
        }
      }

      // 2. Require a connected wallet and extract its address
      const account = wallet.account
      if (!account) {
        throw new TransactionError('Wallet is not connected. Please connect your wallet first.')
      }

      // 3. Run the transaction
      try {
        return await action(input, account.address)
      } catch (e) {
        if (e instanceof TransactionError) throw e
        // The wrapped label is all the UI renders, so without this the real
        // reason vanishes — and wallet-protocol failures (session, chain,
        // minContextSlot) are exactly the ones you need to see. Log it.
        console.error(`[wallet] ${actionLabel} failed:`, e)
        throw new TransactionError(`Failed to ${actionLabel}`, e)
      }
    },
    [validate, action, actionLabel, wallet],
  )

  return useMutation({ mutationFn })
}
