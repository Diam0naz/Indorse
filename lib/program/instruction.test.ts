/**
 * lib/program/instruction.test.ts — IDL-driven instruction building.
 *
 * Asserts that roles, fixed addresses and data layout all come from the IDL:
 * signers/writables match the program's account constraints, the system
 * program is filled in automatically, and the payload round-trips through the
 * codec.
 */

import { describe, expect, it } from 'vitest'
import { AccountRole } from '@solana/kit'
import { buildCreateAtaInstruction, buildInstruction, instructionAccountNames } from '@/lib/program/instruction'
import { decodeInstructionArgs } from '@/lib/program/codec'
import { instructionDiscriminator } from '@/lib/program/idl'
import { PROGRAM_ID } from '@/constants/app-config'

const OWNER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const FARM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const COUNTER = 'Sysvar1nstructions1111111111111111111111111'
const REPORT = '11111111111111111111111111111111'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

describe('buildInstruction', () => {
  it('builds register_farm with IDL roles and fixed addresses', () => {
    const ix = buildInstruction(
      'register_farm',
      { owner: OWNER, farmCounter: COUNTER, farm: FARM },
      { name: 'X', latE6: 1, lngE6: 2 },
    )

    expect(ix.programAddress).toBe(PROGRAM_ID)
    expect(instructionAccountNames('register_farm')).toEqual(['owner', 'farmCounter', 'farm', 'systemProgram'])

    expect(ix.accounts).toHaveLength(4)
    expect(ix.accounts?.[0]).toEqual({ address: OWNER, role: AccountRole.WRITABLE_SIGNER })
    expect(ix.accounts?.[1]).toEqual({ address: COUNTER, role: AccountRole.WRITABLE })
    expect(ix.accounts?.[2]).toEqual({ address: FARM, role: AccountRole.WRITABLE })
    // system program comes from the IDL, not the caller
    expect(ix.accounts?.[3]).toEqual({ address: SYSTEM_PROGRAM, role: AccountRole.READONLY })

    expect(Array.from(ix.data!.slice(0, 8))).toEqual(Array.from(instructionDiscriminator('register_farm')))
    expect(decodeInstructionArgs(ix.data!, 'register_farm')).toEqual({ name: 'X', latE6: 1, lngE6: 2 })
  })

  it('builds submit_scout_report with a readonly farm and writable report', () => {
    const photoHash = Array.from({ length: 32 }, () => 7)
    const ix = buildInstruction(
      'submit_scout_report',
      { reporter: OWNER, farm: FARM, report: REPORT },
      { photoHash, uri: 'u', latE6: 0, lngE6: 0, aiLabel: 'Healthy' },
    )

    expect(ix.accounts?.[0]).toEqual({ address: OWNER, role: AccountRole.WRITABLE_SIGNER })
    expect(ix.accounts?.[1]).toEqual({ address: FARM, role: AccountRole.WRITABLE })
    expect(ix.accounts?.[2]).toEqual({ address: REPORT, role: AccountRole.WRITABLE })
    expect(ix.accounts?.[3]).toEqual({ address: SYSTEM_PROGRAM, role: AccountRole.READONLY })
  })

  it('rejects a missing non-fixed account', () => {
    expect(() => buildInstruction('register_farm', { owner: OWNER }, { name: 'X', latE6: 1, lngE6: 2 })).toThrow(
      /Missing account "farmCounter"/,
    )
  })
})

describe('buildCreateAtaInstruction', () => {
  it('builds CreateIdempotent against the associated token account program', () => {
    const ix = buildCreateAtaInstruction({ payer: OWNER, ata: FARM, owner: REPORT, mint: SYSTEM_PROGRAM })

    expect(ix.programAddress).toBe('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    expect(ix.accounts).toHaveLength(6)
    expect(ix.accounts?.[0]).toEqual({ address: OWNER, role: AccountRole.WRITABLE_SIGNER })
    expect(ix.accounts?.[1]).toEqual({ address: FARM, role: AccountRole.WRITABLE })
    expect(ix.accounts?.[2]).toEqual({ address: REPORT, role: AccountRole.READONLY })
    expect(ix.accounts?.[3]).toEqual({ address: SYSTEM_PROGRAM, role: AccountRole.READONLY })
    expect(ix.accounts?.[4]).toEqual({ address: SYSTEM_PROGRAM, role: AccountRole.READONLY })
    expect(ix.accounts?.[5]).toEqual({
      address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      role: AccountRole.READONLY,
    })
    expect(Array.from(ix.data!)).toEqual([1])
  })
})
