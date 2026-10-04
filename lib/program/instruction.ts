/**
 * lib/program/instruction.ts — Build kit `Instruction`s from the IDL.
 *
 * Account roles come straight from the IDL entry (`writable`/`signer`), fixed
 * addresses (system/token programs) are filled automatically, and everything
 * else is caller-supplied under its camelCase name — PDAs from `./pdas`,
 * signers from the connected wallet.
 *
 * The result is a plain kit `Instruction` (`{ programAddress, accounts, data }`)
 * which is exactly what `wallet.sendTransactions([ix])` accepts.
 */

import { AccountRole, address, type AccountMeta, type Address, type Instruction } from '@solana/kit'
import { IDL_PROGRAM_ID, instructionDef, snakeToCamel, type IdlInstructionAccount } from './idl'
import { encodeInstructionArgs } from './codec'

/** camelCase name → base58 address, e.g. `{ owner, farm }`. */
export type InstructionAccounts = Record<string, string>

function roleFor(entry: IdlInstructionAccount): AccountRole {
  if (entry.signer && entry.writable) return AccountRole.WRITABLE_SIGNER
  if (entry.signer) return AccountRole.READONLY_SIGNER
  if (entry.writable) return AccountRole.WRITABLE
  return AccountRole.READONLY
}

/**
 * Build the kit instruction for `name`.
 *
 * @param name    IDL instruction name, e.g. `register_farm`
 * @param accounts camelCase addresses for every non-fixed account
 * @param args     camelCase argument values in any order (IDL dictates layout)
 */
export function buildInstruction(
  name: string,
  accounts: InstructionAccounts,
  args: Record<string, unknown> = {},
): Instruction {
  const ix = instructionDef(name)

  const metas: AccountMeta[] = ix.accounts.map((entry) => {
    const fixed = entry.address
    const supplied = accounts[snakeToCamel(entry.name)]
    const target = fixed ?? supplied
    if (!target) throw new Error(`Missing account "${snakeToCamel(entry.name)}" for instruction ${name}`)
    return { address: address(target), role: roleFor(entry) }
  })

  const data = encodeInstructionArgs(ix, args)
  return {
    programAddress: address(IDL_PROGRAM_ID),
    accounts: metas,
    data,
  } as Instruction
}

/** The IDL argument names for an instruction, camelCased (form/tests helper). */
export function instructionArgNames(name: string): string[] {
  return instructionDef(name).args.map((a) => snakeToCamel(a.name))
}

/** The IDL account names for an instruction, camelCased (tests helper). */
export function instructionAccountNames(name: string): string[] {
  return instructionDef(name).accounts.map((a) => snakeToCamel(a.name))
}

/** Type guard used by callers holding untrusted address strings. */
export function isAddressLike(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
}

/** Narrow a plain string to kit `Address` after validating the base58 shape. */
export function toAddress(value: string): Address {
  if (!isAddressLike(value)) throw new Error(`"${value}" is not a base58 address`)
  return address(value)
}
