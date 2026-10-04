import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { IndorseProgram } from '../target/types/indorse_program'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { createMint, createAccount, mintTo, getAccount, transfer } from '@solana/spl-token'
import { assert } from 'chai'

describe('indorse_program', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const program = anchor.workspace.IndorseProgram as Program<IndorseProgram>

  // Test accounts
  let owner: Keypair
  let reporter: Keypair
  let authority: Keypair

  // PDAs
  let farmPda: PublicKey
  let farmBump: number
  let reportPda: PublicKey
  let reportBump: number
  let rewardAuthorityPda: PublicKey
  let rewardAuthorityBump: number

  // Token accounts
  let rewardMint: PublicKey
  let rewardVault: PublicKey
  let reporterTokenAccount: PublicKey

  // USDC + treasury-pool insurance state
  let usdcMint: PublicKey
  let ownerUsdc: PublicKey
  let adminUsdc: PublicKey
  let policyPda: PublicKey
  let policyVault: PublicKey

  const FARM_NAME = 'Green Valley Farm'
  const LAT_E6 = 34052000 // 34.052000 (LA)
  const LNG_E6 = -118243000 // -118.243000 (LA)
  const PHOTO_HASH = new Array(32).fill(7)
  const REPORT_URI = 'https://example.com/photo.jpg'
  const AI_LABEL = 'healthy_corn'
  const REWARD_AMOUNT = 1_000_000

  // Treasury-pool insurance (amounts in 6-decimal USDC)
  const COVERAGE = 40_000_000 // 40 USDC
  const PREMIUM = 5_000_000 // 5 USDC
  const THRESHOLD_MM = 500 // trigger fires below 50.0 mm
  const RAINFALL_MM = 800 // season read 80.0 mm → no trigger
  const SEASON_START = 1_700_000_000 // fixed past season (Nov 2023)
  const SEASON_END = 1_704_768_000
  const READING_TS = 1_704_700_000
  const ESCROW_USDC = 10_000_000 // 10 USDC

  const u32le = (n: number) => new anchor.BN(n).toArrayLike(Buffer, 'le', 4)
  const i64le = (n: number) => new anchor.BN(n).toArrayLike(Buffer, 'le', 8)

  before(async () => {
    // Create test keypairs
    owner = Keypair.generate()
    reporter = Keypair.generate()
    authority = Keypair.generate()

    // Airdrop SOL to all test accounts
    await provider.connection.requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    await provider.connection.requestAirdrop(reporter.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    await provider.connection.requestAirdrop(authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Derive farm PDA
    ;[farmPda, farmBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('farm'), owner.publicKey.toBuffer()],
      program.programId,
    )

    // Derive reward authority PDA
    ;[rewardAuthorityPda, rewardAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('reward_authority')],
      program.programId,
    )

    // Create reward token mint
    rewardMint = await createMint(provider.connection, authority, authority.publicKey, null, 6)

    // Create reward vault (token account owned by reward authority PDA)
    rewardVault = await createAccount(
      provider.connection,
      authority,
      rewardMint,
      rewardAuthorityPda,
      Keypair.generate(),
    )

    // Create reporter's token account
    reporterTokenAccount = await createAccount(provider.connection, authority, rewardMint, reporter.publicKey)

    // Mint tokens to the reward vault
    await mintTo(provider.connection, authority, rewardMint, rewardVault, authority, 1_000_000_000)
  })

  it('Register a farm', async () => {
    await program.methods
      .registerFarm(FARM_NAME, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6))
      .accounts({
        owner: owner.publicKey,
        farm: farmPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc()

    const farmAccount = await program.account.farm.fetch(farmPda)

    assert.equal(farmAccount.name, FARM_NAME)
    assert.equal(farmAccount.latE6, LAT_E6)
    assert.equal(farmAccount.lngE6, LNG_E6)
    assert.equal(farmAccount.reportCount, 0)
    assert.equal(farmAccount.batchCount, 0)
    assert.equal(farmAccount.owner.toBase58(), owner.publicKey.toBase58())
    assert.equal(farmAccount.bump, farmBump)
  })

  it('Reject farm name longer than 64 characters', async () => {
    const longName = 'A'.repeat(65)

    // Fresh owner → fresh farm PDA, so the length check in the handler is
    // what rejects (the farm does not exist yet).
    const freshOwner = Keypair.generate()
    const dropSig = await provider.connection.requestAirdrop(freshOwner.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    await provider.connection.confirmTransaction(dropSig)
    const [freshFarm] = PublicKey.findProgramAddressSync(
      [Buffer.from('farm'), freshOwner.publicKey.toBuffer()],
      program.programId,
    )

    try {
      await program.methods
        .registerFarm(longName, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6))
        .accounts({
          owner: freshOwner.publicKey,
          farm: freshFarm,
          systemProgram: SystemProgram.programId,
        })
        .signers([freshOwner])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'Farm name too long')
    }
  })

  it('Submit a scout report', async () => {
    // Derive report PDA using current report_count (0)
    ;[reportPda, reportBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), new anchor.BN(0).toArrayLike(Buffer, 'le', 4)],
      program.programId,
    )

    await program.methods
      .submitScoutReport(PHOTO_HASH, REPORT_URI, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6), AI_LABEL)
      .accounts({
        reporter: reporter.publicKey,
        farm: farmPda,
        report: reportPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([reporter])
      .rpc()

    const reportAccount = await program.account.scoutReport.fetch(reportPda)

    assert.equal(reportAccount.farm.toBase58(), farmPda.toBase58())
    assert.equal(reportAccount.reporter.toBase58(), reporter.publicKey.toBase58())
    assert.equal(reportAccount.index, 0)
    assert.deepEqual(reportAccount.photoHash, PHOTO_HASH)
    assert.equal(reportAccount.uri, REPORT_URI)
    assert.equal(reportAccount.latE6, LAT_E6)
    assert.equal(reportAccount.lngE6, LNG_E6)
    assert.equal(reportAccount.aiLabel, AI_LABEL)
    assert.deepEqual(reportAccount.status, { pending: {} })
    assert.equal(reportAccount.verifier.toBase58(), PublicKey.default.toBase58())
    assert.equal(reportAccount.bump, reportBump)

    // Verify farm's report count incremented
    const farmAccount = await program.account.farm.fetch(farmPda)
    assert.equal(farmAccount.reportCount, 1)
  })

  it('Reject URI longer than 128 characters', async () => {
    const longUri = 'https://example.com/' + 'A'.repeat(120)

    // report_count is 1 after the first report — derive the next index so the
    // handler's length check fires instead of the PDA init/seeds check.
    const [reportNextPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), u32le(1)],
      program.programId,
    )

    try {
      await program.methods
        .submitScoutReport(PHOTO_HASH, longUri, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6), AI_LABEL)
        .accounts({
          reporter: reporter.publicKey,
          farm: farmPda,
          report: reportNextPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([reporter])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'URI too long')
    }
  })

  it('Reject AI label longer than 32 characters', async () => {
    const longLabel = 'A'.repeat(33)

    // report_count is 1 after the first report — derive the next index so the
    // handler's length check fires instead of the PDA init/seeds check.
    const [reportNextPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), u32le(1)],
      program.programId,
    )

    try {
      await program.methods
        .submitScoutReport(PHOTO_HASH, REPORT_URI, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6), longLabel)
        .accounts({
          reporter: reporter.publicKey,
          farm: farmPda,
          report: reportNextPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([reporter])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'Label too long')
    }
  })

  it('Verify a scout report (approved)', async () => {
    await program.methods
      .verifyScoutReport(true)
      .accounts({
        verifier: provider.wallet.publicKey,
        report: reportPda,
        farm: farmPda,
      })
      .rpc()

    const reportAccount = await program.account.scoutReport.fetch(reportPda)

    assert.deepEqual(reportAccount.status, { verified: {} })
    assert.equal(reportAccount.verifier.toBase58(), provider.wallet.publicKey.toBase58())
  })

  it('Reject verifying an already-verified report', async () => {
    try {
      await program.methods
        .verifyScoutReport(true)
        .accounts({
          verifier: provider.wallet.publicKey,
          report: reportPda,
          farm: farmPda,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already verified or rejected')
    }
  })

  it('Reward a verified report', async () => {
    const vaultBefore = await getAccount(provider.connection, rewardVault)
    const reporterBefore = await getAccount(provider.connection, reporterTokenAccount)

    await program.methods
      .rewardReport(new anchor.BN(REWARD_AMOUNT))
      .accounts({
        authority: provider.wallet.publicKey,
        report: reportPda,
        rewardAuthority: rewardAuthorityPda,
        rewardVault: rewardVault,
        reporterTokenAccount: reporterTokenAccount,
        rewardMint: rewardMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc()

    const vaultAfter = await getAccount(provider.connection, rewardVault)
    const reporterAfter = await getAccount(provider.connection, reporterTokenAccount)

    assert.equal(Number(vaultAfter.amount), Number(vaultBefore.amount) - REWARD_AMOUNT)
    assert.equal(Number(reporterAfter.amount), Number(reporterBefore.amount) + REWARD_AMOUNT)
  })

  it('Reject rewarding a non-verified report', async () => {
    // Create a new report (index 1)
    const [report2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), new anchor.BN(1).toArrayLike(Buffer, 'le', 4)],
      program.programId,
    )

    await program.methods
      .submitScoutReport(PHOTO_HASH, REPORT_URI, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6), AI_LABEL)
      .accounts({
        reporter: reporter.publicKey,
        farm: farmPda,
        report: report2Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([reporter])
      .rpc()

    // Try to reward without verifying
    try {
      await program.methods
        .rewardReport(new anchor.BN(REWARD_AMOUNT))
        .accounts({
          authority: provider.wallet.publicKey,
          report: report2Pda,
          rewardAuthority: rewardAuthorityPda,
          rewardVault: rewardVault,
          reporterTokenAccount: reporterTokenAccount,
          rewardMint: rewardMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'is not verified')
    }
  })

  it('Verify and reject a scout report', async () => {
    // Create a new report (index 2)
    const [report3Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), new anchor.BN(2).toArrayLike(Buffer, 'le', 4)],
      program.programId,
    )

    await program.methods
      .submitScoutReport(PHOTO_HASH, REPORT_URI, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6), AI_LABEL)
      .accounts({
        reporter: reporter.publicKey,
        farm: farmPda,
        report: report3Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([reporter])
      .rpc()

    // Reject it
    await program.methods
      .verifyScoutReport(false)
      .accounts({
        verifier: provider.wallet.publicKey,
        report: report3Pda,
        farm: farmPda,
      })
      .rpc()

    const reportAccount = await program.account.scoutReport.fetch(report3Pda)
    assert.deepEqual(reportAccount.status, { rejected: {} })
  })

  // ── Treasury-pool insurance ────────────────────────────────────────────────

  it('Set up USDC accounts for farmer and treasury', async () => {
    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6)
    ownerUsdc = await createAccount(provider.connection, owner, usdcMint, owner.publicKey)
    await mintTo(provider.connection, owner, usdcMint, ownerUsdc, owner, 1_000_000_000)

    // Treasury token account owned by the admin (the provider wallet in tests)
    adminUsdc = await createAccount(provider.connection, owner, usdcMint, provider.wallet.publicKey)
    await mintTo(provider.connection, owner, usdcMint, adminUsdc, owner, 1_000_000_000) // 1000 USDC float

    ;[policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('policy'), farmPda.toBuffer(), u32le(0)],
      program.programId,
    )
    ;[policyVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('insurance_vault'), farmPda.toBuffer(), u32le(0)],
      program.programId,
    )
  })

  it('Create a policy with only the farmer signing', async () => {
    await program.methods
      .createPolicy(
        'maize',
        new anchor.BN(COVERAGE),
        new anchor.BN(PREMIUM),
        THRESHOLD_MM,
        new anchor.BN(SEASON_START),
        new anchor.BN(SEASON_END),
      )
      .accounts({
        farmer: owner.publicKey,
        farm: farmPda,
        policy: policyPda,
        insuranceVault: policyVault,
        farmerUsdc: ownerUsdc,
        usdcMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc()

    const policy = await program.account.policy.fetch(policyPda)
    assert.equal(policy.farmer.toBase58(), owner.publicKey.toBase58())
    assert.equal(policy.coverageUsdc.toNumber(), COVERAGE)
    assert.equal(policy.premiumUsdc.toNumber(), PREMIUM)
    assert.deepEqual(policy.state, { active: {} })

    // Only the premium is in the vault — coverage arrives from the treasury.
    const vault = await getAccount(provider.connection, policyVault)
    assert.equal(Number(vault.amount), PREMIUM)
  })

  it('Fund coverage from the treasury with a plain token transfer', async () => {
    const treasury = (provider.wallet as anchor.Wallet).payer

    // No instruction needed: anyone can credit the vault.
    await transfer(provider.connection, treasury, adminUsdc, policyVault, treasury, COVERAGE)

    const vault = await getAccount(provider.connection, policyVault)
    assert.equal(Number(vault.amount), PREMIUM + COVERAGE)
  })

  it('Post the season reading and reject a refund to a non-treasury account', async () => {
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('weather'), farmPda.toBuffer(), i64le(SEASON_START)],
      program.programId,
    )

    await program.methods
      .submitWeatherReading(new anchor.BN(SEASON_START), RAINFALL_MM, new anchor.BN(READING_TS))
      .accounts({
        authority: provider.wallet.publicKey,
        farm: farmPda,
        oracle: oraclePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    const oracle = await program.account.weatherOracle.fetch(oraclePda)
    assert.equal(oracle.totalRainfallMm, RAINFALL_MM)

    // Refund destination owned by the farmer, not the treasury → rejected.
    try {
      await program.methods
        .settlePolicy()
        .accounts({
          settler: provider.wallet.publicKey,
          policy: policyPda,
          insuranceVault: policyVault,
          oracle: oraclePda,
          farmerUsdc: ownerUsdc,
          insurerUsdc: ownerUsdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'TokenAccountInvalid')
    }
  })

  it('Settle without a trigger: coverage returns to the treasury', async () => {
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('weather'), farmPda.toBuffer(), i64le(SEASON_START)],
      program.programId,
    )
    const treasuryBefore = (await getAccount(provider.connection, adminUsdc)).amount

    await program.methods
      .settlePolicy()
      .accounts({
        settler: provider.wallet.publicKey,
        policy: policyPda,
        insuranceVault: policyVault,
        oracle: oraclePda,
        farmerUsdc: ownerUsdc,
        insurerUsdc: adminUsdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc()

    const settled = await program.account.policy.fetch(policyPda)
    assert.deepEqual(settled.state, { expired: {} })

    const treasuryAfter = (await getAccount(provider.connection, adminUsdc)).amount
    assert.equal(Number(treasuryAfter), Number(treasuryBefore) + COVERAGE)

    // The premium stays in the policy vault.
    const vault = await getAccount(provider.connection, policyVault)
    assert.equal(Number(vault.amount), PREMIUM)
  })

  // ── Escrow lifecycle ───────────────────────────────────────────────────────

  it('Cancel closes both escrow PDAs and frees the batch for retry', async () => {
    const [batchPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('batch'), farmPda.toBuffer(), u32le(0)],
      program.programId,
    )
    await program.methods
      .submitHarvestBatch(
        PHOTO_HASH,
        'ipfs://batch-0.json',
        new anchor.BN(LAT_E6),
        new anchor.BN(LNG_E6),
        'maize',
        new anchor.BN(1000),
        'Grade A, pesticide-free',
      )
      .accounts({
        farmer: owner.publicKey,
        farm: farmPda,
        batch: batchPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc()

    const buyer = Keypair.generate()
    const dropSig = await provider.connection.requestAirdrop(buyer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    await provider.connection.confirmTransaction(dropSig)
    const buyerUsdc = await createAccount(provider.connection, owner, usdcMint, buyer.publicKey)
    await mintTo(provider.connection, owner, usdcMint, buyerUsdc, owner, 100_000_000) // 100 USDC

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), batchPda.toBuffer()],
      program.programId,
    )
    const [escrowVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow_vault'), batchPda.toBuffer()],
      program.programId,
    )
    const lockUntil = Math.floor(Date.now() / 1000) + 3600

    const fund = () =>
      program.methods
        .createEscrow(new anchor.BN(ESCROW_USDC), new anchor.BN(lockUntil))
        .accounts({
          buyer: buyer.publicKey,
          batch: batchPda,
          escrow: escrowPda,
          escrowVault,
          buyerUsdc,
          usdcMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])

    await fund().rpc()
    const escrow = await program.account.escrow.fetch(escrowPda)
    assert.deepEqual(escrow.state, { funded: {} })

    await program.methods
      .cancelEscrow()
      .accounts({
        buyer: buyer.publicKey,
        escrow: escrowPda,
        escrowVault,
        buyerUsdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc()

    // Both PDAs are closed: rent refunded and the batch slot freed.
    assert.isNull(await provider.connection.getAccountInfo(escrowPda))
    assert.isNull(await provider.connection.getAccountInfo(escrowVault))
    assert.equal(Number((await getAccount(provider.connection, buyerUsdc)).amount), 100_000_000)

    // The same batch can be escrowed again.
    await fund().rpc()
    const retried = await program.account.escrow.fetch(escrowPda)
    assert.deepEqual(retried.state, { funded: {} })
  })
})
