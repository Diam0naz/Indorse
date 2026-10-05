/**
 * lib/program/generated-client.test.ts — Drift guard between the Codama client
 * and the hand-rolled IDL client.
 *
 * `lib/generated/indorse` is rendered from the same `lib/idl/indorse_program.json`
 * that `lib/program/*` reads at runtime, so the two only stay in step while the
 * generator is rerun after every `idl:sync`. The program address, every
 * instruction discriminator, the argument encoding and the PDA seeds all have
 * to survive that round trip — these assertions are what fails the suite when
 * they do not.
 */

import { address } from '@solana/kit'
import { describe, expect, it } from 'vitest'

import { PROGRAM_ID } from '@/constants/app-config'
import {
  findConfigPda,
  findEscrowPda,
  findEscrowVaultPda,
  findFarmPda,
  findOraclePda,
  findOracleSetPda,
  findRewardAuthorityPda,
  findTallyPda,
  findTreasuryPda,
  findVerifierSetPda,
  getRegisterFarmInstructionDataEncoder,
  identifyIndorseProgramInstruction,
  INDORSE_PROGRAM_PROGRAM_ADDRESS,
  IndorseProgramInstruction,
} from '@/lib/generated/indorse'
import { IDL, IDL_PROGRAM_ID, instructionDiscriminator } from '@/lib/program/idl'
import { buildInstruction } from '@/lib/program/instruction'
import {
  configPda,
  escrowPda,
  escrowVaultPda,
  farmPda,
  oracleSetPda,
  rewardAuthorityPda,
  tallyPda,
  treasuryPda,
  verifierSetPda,
  weatherOraclePda,
} from '@/lib/program/pdas'

const OWNER = 'AXUTwBhtwbgAJGAZYKHXAJgSo4dMC29XrnbP91BPcYg8'
const FARM = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const BATCH = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const REPORT = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const SEASON_START = 1_767_225_600

/** Every IDL instruction mapped to the enum the generated client must return. */
const INSTRUCTION_KINDS: Record<string, IndorseProgramInstruction> = {
  add_oracle: IndorseProgramInstruction.AddOracle,
  cancel_escrow: IndorseProgramInstruction.CancelEscrow,
  cast_vote: IndorseProgramInstruction.CastVote,
  create_escrow: IndorseProgramInstruction.CreateEscrow,
  create_policy: IndorseProgramInstruction.CreatePolicy,
  delete_farm: IndorseProgramInstruction.DeleteFarm,
  init_config: IndorseProgramInstruction.InitConfig,
  init_oracle_set: IndorseProgramInstruction.InitOracleSet,
  init_verifier_set: IndorseProgramInstruction.InitVerifierSet,
  post_bond: IndorseProgramInstruction.PostBond,
  reconfigure_verifier_set: IndorseProgramInstruction.ReconfigureVerifierSet,
  register_farm: IndorseProgramInstruction.RegisterFarm,
  register_switchboard_feed: IndorseProgramInstruction.RegisterSwitchboardFeed,
  release_escrow: IndorseProgramInstruction.ReleaseEscrow,
  release_verifier: IndorseProgramInstruction.ReleaseVerifier,
  remove_oracle: IndorseProgramInstruction.RemoveOracle,
  remove_verifier: IndorseProgramInstruction.RemoveVerifier,
  revoke_policy: IndorseProgramInstruction.RevokePolicy,
  reward_report: IndorseProgramInstruction.RewardReport,
  set_roles: IndorseProgramInstruction.SetRoles,
  settle_policy: IndorseProgramInstruction.SettlePolicy,
  slash_verifier: IndorseProgramInstruction.SlashVerifier,
  submit_harvest_batch: IndorseProgramInstruction.SubmitHarvestBatch,
  submit_oracle_reading: IndorseProgramInstruction.SubmitOracleReading,
  submit_scout_report: IndorseProgramInstruction.SubmitScoutReport,
  submit_switchboard_reading: IndorseProgramInstruction.SubmitSwitchboardReading,
  withdraw_treasury: IndorseProgramInstruction.WithdrawTreasury,
}

describe('generated Codama client', () => {
  it('targets the same program as the IDL and the app config', () => {
    expect(INDORSE_PROGRAM_PROGRAM_ADDRESS).toBe(IDL_PROGRAM_ID)
    expect(INDORSE_PROGRAM_PROGRAM_ADDRESS).toBe(PROGRAM_ID)
  })

  it('identifies every IDL instruction by its 8-byte discriminator', () => {
    // Guards the other direction too: an instruction added to the program but
    // never regenerated shows up here as a missing case.
    expect(Object.keys(INSTRUCTION_KINDS).sort()).toEqual(IDL.instructions.map((ix) => ix.name).sort())

    for (const [name, kind] of Object.entries(INSTRUCTION_KINDS)) {
      expect(identifyIndorseProgramInstruction({ data: instructionDiscriminator(name) })).toBe(kind)
    }
  })

  it('encodes register_farm byte-for-byte like the IDL client', () => {
    const args = { name: 'Farm Co', latE6: -1_234_567, lngE6: 7_654_321 }

    const generated = getRegisterFarmInstructionDataEncoder().encode(args)
    const handRolled = buildInstruction('register_farm', { owner: OWNER, farm: FARM }, args).data

    expect(handRolled).toBeDefined()
    expect(Array.from(generated)).toEqual(Array.from(handRolled!))
  })

  it('derives the same PDAs as lib/program/pdas', async () => {
    expect((await findFarmPda({ owner: address(OWNER) }))[0]).toBe(await farmPda(OWNER))
    expect((await findEscrowPda({ batch: address(BATCH) }))[0]).toBe(await escrowPda(BATCH))
    expect((await findEscrowVaultPda({ batch: address(BATCH) }))[0]).toBe(await escrowVaultPda(BATCH))
    expect((await findOraclePda({ farm: address(FARM), seasonStart: SEASON_START }))[0]).toBe(
      await weatherOraclePda(FARM, SEASON_START),
    )
    expect((await findRewardAuthorityPda())[0]).toBe(await rewardAuthorityPda())
    expect((await findConfigPda())[0]).toBe(await configPda())
    expect((await findTreasuryPda())[0]).toBe(await treasuryPda())
    expect((await findVerifierSetPda())[0]).toBe(await verifierSetPda())
    expect((await findOracleSetPda())[0]).toBe(await oracleSetPda())
    expect((await findTallyPda({ report: address(REPORT) }))[0]).toBe(await tallyPda(REPORT))
  })
})
