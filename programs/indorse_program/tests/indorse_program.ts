import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { IndorseProgram } from '../target/types/indorse_program'
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from '@solana/web3.js'
import {
  createMint,
  createAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  transfer,
} from '@solana/spl-token'
import { assert } from 'chai'
import { createPrivateKey, sign as signEd25519 } from 'node:crypto'

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
  let configPda: PublicKey
  let treasuryPda: PublicKey

  // Token accounts
  let rewardMint: PublicKey
  let rewardVault: PublicKey
  let reporterTokenAccount: PublicKey

  // USDC + treasury-pool insurance state
  let usdcMint: PublicKey
  let ownerUsdc: PublicKey
  let adminUsdc: PublicKey
  let treasuryUsdc: PublicKey
  let policyPda: PublicKey
  let policyVault: PublicKey

  // Phase 1 — K-of-N verifier set (quorum k=2, two bonded members)
  const K = 2
  const BOND = 5_000_000 // 5 USDC per seat
  const REPRICED_BOND = 7_000_000 // 7 USDC — the Phase 3A reconfigured seat price
  let verifierSetPda: PublicKey
  let bondVault: PublicKey
  let verifierA: Keypair
  let verifierB: Keypair
  let verifierC: Keypair
  let verifierUsdcA: PublicKey
  let verifierUsdcB: PublicKey
  let verifierUsdcC: PublicKey

  // Phase 2 — oracle-set median (odd quorum k=3, three unbound readers)
  const ORACLE_K = 3
  let oracleSetPda: PublicKey
  let oraclePda: PublicKey
  let oracleA: Keypair
  let oracleB: Keypair
  let oracleC: Keypair

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
  const ESCROW_USDC = 10_000_000 // 10 USDC

  // Phase 3B — Switchboard On-Demand receipt relay (role 1, permissionless).
  // One fixed season and the probe's real job hash, so the suite pins the
  // exact bytes devnet will; three enclave keys the admin may trust.
  const SB_SEASON_START = 1_710_000_000
  const SB_FEED = Keypair.generate().publicKey
  const SB_FEED_HASH = Array.from(
    Buffer.from('1e70a1ea0099fc2c5146d332ecd10824ba421cc2480ba74828640e94f3f84623', 'hex'),
  )
  const sbEnclaves = [Keypair.generate(), Keypair.generate(), Keypair.generate()]
  let sbBindingPda: PublicKey
  let sbTallyPda: PublicKey

  const u32le = (n: number) => new anchor.BN(n).toArrayLike(Buffer, 'le', 4)

  // Phase 1 helpers — quorum voting (k=2; members bonded in the setup test)
  const tallyFor = (report: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from('tally'), report.toBuffer()], program.programId)[0]

  const castVote = (report: PublicKey, approve: boolean, by: Keypair) =>
    program.methods
      .castVote(approve)
      .accounts({
        voter: by.publicKey,
        verifierSet: verifierSetPda,
        report,
        farm: farmPda,
        tally: tallyFor(report),
        systemProgram: SystemProgram.programId,
      })
      .signers([by])
      .rpc()

  // Phase 1 helper — join the set by posting the CURRENT seat price
  const bondSeat = (by: Keypair, usdc: PublicKey) =>
    program.methods
      .postBond()
      .accounts({
        member: by.publicKey,
        verifierSet: verifierSetPda,
        bondVault,
        usdcMint,
        memberUsdc: usdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([by])
      .rpc()

  // Phase 2 helper — post a season reading as one oracle-set member
  const submitReading = (by: Keypair, mm: number, season = SEASON_START, tally = oraclePda) =>
    program.methods
      .submitOracleReading(new anchor.BN(season), mm)
      .accounts({
        member: by.publicKey,
        oracleSet: oracleSetPda,
        farm: farmPda,
        oracle: tally,
        systemProgram: SystemProgram.programId,
      })
      .signers([by])
      .rpc()

  // Anchor runs an instruction's `init` rent transfer before its account
  // constraints, so a zero-lamport keypair that PAYS for an init (verifier-set
  // payer, first-vote tally payer) dies on the transfer instead of reaching
  // the gate the test is actually asserting. Fund transient signers first.
  const fund = async (pubkey: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(pubkey, 1_000_000_000)
    await provider.connection.confirmTransaction(sig, 'confirmed')
  }
  const i64le = (n: number) => new anchor.BN(n).toArrayLike(Buffer, 'le', 8)

  // Phase 3B helpers — a Switchboard receipt is an 81-byte message signed by
  // the job's enclave keys and carried in the same transaction as the submit
  // instruction's Ed25519 precompile, whose verified signer/message pairs the
  // program re-reads through the instructions sysvar.
  const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
  const ED25519_VERIFY_PROGRAM = new PublicKey('Ed25519SigVerify111111111111111111111111111')

  const signWithSeed = (message: Buffer, kp: Keypair) =>
    signEd25519(
      null,
      message,
      createPrivateKey({
        key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(kp.secretKey.subarray(0, 32))]),
        format: 'der',
        type: 'pkcs8',
      }),
    )

  const i128le = (n: bigint) => {
    const bytes = Buffer.alloc(16)
    let rest = n
    for (let i = 0; i < 16; i++) {
      bytes[i] = Number(rest & 0xffn)
      rest >>= 8n
    }
    return bytes
  }

  // slothash(32) ‖ feed hash(32) ‖ i128 value LE(16) ‖ min_samples(1) = 81 bytes
  const receiptMessage = (slothash: Buffer, feedHash: number[], value: bigint) =>
    Buffer.concat([slothash, Buffer.from(feedHash), i128le(value), Buffer.from([1])])

  // The precompile's wire layout: num_signatures ‖ pad ‖ one 14-byte struct
  // per signer (65535 = "this instruction", the sentinel solana-sdk and
  // web3.js both emit), then the shared signature/public-key/message blobs.
  const ed25519Instruction = (message: Buffer, signers: Keypair[]) => {
    const n = signers.length
    const sigBase = 2 + n * 14
    const pkBase = sigBase + n * 64
    const msgBase = pkBase + n * 32
    const data = Buffer.alloc(msgBase + message.length)
    data[0] = n
    for (let i = 0; i < n; i++) {
      const base = 2 + i * 14
      data.writeUInt16LE(sigBase + i * 64, base)
      data.writeUInt16LE(65535, base + 2)
      data.writeUInt16LE(pkBase + i * 32, base + 4)
      data.writeUInt16LE(65535, base + 6)
      data.writeUInt16LE(msgBase, base + 8)
      data.writeUInt16LE(message.length, base + 10)
      data.writeUInt16LE(65535, base + 12)
    }
    signers.forEach((kp, i) => {
      signWithSeed(message, kp).copy(data, sigBase + i * 64)
      Buffer.from(kp.publicKey.toBytes()).copy(data, pkBase + i * 32)
    })
    message.copy(data, msgBase)
    return new TransactionInstruction({ programId: ED25519_VERIFY_PROGRAM, keys: [], data })
  }

  // A still-live slothash: SlotHashes is 8-byte count, then count × (slot ‖ hash).
  const freshSlothash = async (): Promise<Buffer> => {
    const info = await provider.connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY)
    if (!info) throw new Error('SlotHashes sysvar missing')
    return Buffer.from(info.data.subarray(16, 48))
  }

  // Relay a receipt exactly as any stranger would: one transaction carrying
  // the precompile proof and the permissionless submit instruction; the
  // relayer signs only to pay for a tally the season has not created yet.
  const relayReceipt = (message: Buffer, enclaves: Keypair[], relayer: Keypair, withPrecompile = true) =>
    program.methods
      .submitSwitchboardReading(new anchor.BN(SB_SEASON_START), SB_FEED)
      .accounts({
        relayer: relayer.publicKey,
        oracleSet: oracleSetPda,
        farm: farmPda,
        binding: sbBindingPda,
        oracle: sbTallyPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(withPrecompile ? [ed25519Instruction(message, enclaves)] : [])
      .signers([relayer])
      .rpc()

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

    // Derive the program-config PDA (Layer 0 — every ops gate reads it)
    ;[configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)

    // Derive the program-treasury PDA (refunds sweep to its USDC ATA)
    ;[treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], program.programId)

    // Derive the verifier-set PDA (Phase 1 — K-of-N quorum lives here)
    ;[verifierSetPda] = PublicKey.findProgramAddressSync([Buffer.from('verifier_set')], program.programId)

    // Derive the oracle-set PDA (Phase 2 — the admin-managed reader seats)
    ;[oracleSetPda] = PublicKey.findProgramAddressSync([Buffer.from('oracle_set')], program.programId)

    // Derive the season weather tally PDA (per farm + season start)
    oraclePda = PublicKey.findProgramAddressSync(
      [Buffer.from('weather'), farmPda.toBuffer(), i64le(SEASON_START)],
      program.programId,
    )[0]

    // Derive the Switchboard feed binding and its own season's tally
    sbBindingPda = PublicKey.findProgramAddressSync(
      [Buffer.from('sb_feed'), farmPda.toBuffer(), i64le(SB_SEASON_START), SB_FEED.toBuffer()],
      program.programId,
    )[0]
    sbTallyPda = PublicKey.findProgramAddressSync(
      [Buffer.from('weather'), farmPda.toBuffer(), i64le(SB_SEASON_START)],
      program.programId,
    )[0]

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

  // ── Layer 0 — config (authority as data) ──────────────────────────────────

  it('Init the config PDA with the bootstrap admin', async () => {
    await program.methods
      .initConfig(provider.wallet.publicKey, provider.wallet.publicKey, provider.wallet.publicKey)
      .accounts({
        initializer: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    const config = await program.account.config.fetch(configPda)
    assert.equal(config.admin.toBase58(), provider.wallet.publicKey.toBase58())
    assert.equal(config.verifier.toBase58(), provider.wallet.publicKey.toBase58())
    assert.equal(config.oracle.toBase58(), provider.wallet.publicKey.toBase58())

    // One-shot: `init` refuses a second configuration.
    try {
      await program.methods
        .initConfig(provider.wallet.publicKey, provider.wallet.publicKey, provider.wallet.publicKey)
        .accounts({
          initializer: provider.wallet.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message.toLowerCase(), 'already')
    }
  })

  it('Rotate roles only by the stored admin, then rotate back', async () => {
    const stranger = Keypair.generate()

    // A key outside the admin role cannot rotate anything.
    try {
      await program.methods
        .setRoles(stranger.publicKey, stranger.publicKey, stranger.publicKey)
        .accounts({ authority: stranger.publicKey, config: configPda })
        .signers([stranger])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'authorised program admin')
    }

    // The admin hands the verifier slot to another key — data, not code.
    await program.methods
      .setRoles(provider.wallet.publicKey, stranger.publicKey, provider.wallet.publicKey)
      .accounts({ authority: provider.wallet.publicKey, config: configPda })
      .rpc()
    assert.equal((await program.account.config.fetch(configPda)).verifier.toBase58(), stranger.publicKey.toBase58())

    // …and takes it back so the verify/reward tests below keep their signer.
    await program.methods
      .setRoles(provider.wallet.publicKey, provider.wallet.publicKey, provider.wallet.publicKey)
      .accounts({ authority: provider.wallet.publicKey, config: configPda })
      .rpc()
    assert.equal(
      (await program.account.config.fetch(configPda)).verifier.toBase58(),
      provider.wallet.publicKey.toBase58(),
    )
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

  // ── Verifier set (Phase 1 — K-of-N quorum with bonded stakes) ────────────

  it('Set up USDC accounts for farmer and treasury', async () => {
    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6)
    ownerUsdc = await createAccount(provider.connection, owner, usdcMint, owner.publicKey)
    await mintTo(provider.connection, owner, usdcMint, ownerUsdc, owner, 1_000_000_000)

    // Treasury token account owned by the admin (the provider wallet in tests)
    adminUsdc = await createAccount(provider.connection, owner, usdcMint, provider.wallet.publicKey)
    await mintTo(provider.connection, owner, usdcMint, adminUsdc, owner, 1_000_000_000) // 1000 USDC float

    // Program treasury: the canonical USDC ATA of the treasury PDA — where
    // settle/revoke sweep refunds, and the only source withdraw_treasury reads.
    // The owner is a PDA, hence allowOwnerOffCurve.
    treasuryUsdc = (await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, treasuryPda, true))
      .address

    ;[policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('policy'), farmPda.toBuffer(), u32le(0)],
      program.programId,
    )
    ;[policyVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('insurance_vault'), farmPda.toBuffer(), u32le(0)],
      program.programId,
    )
  })

  it('Initialises the verifier set with an admin-only quorum of two', async () => {
    const stranger = Keypair.generate()
    await fund(stranger.publicKey) // pays init rent; the gate must still reject

    // Only config.admin may set the rules.
    try {
      await program.methods
        .initVerifierSet(K, new anchor.BN(BOND))
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    // k = 1 would recreate the single-verifier regime Phase 1 removed.
    try {
      await program.methods
        .initVerifierSet(1, new anchor.BN(BOND))
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'Quorum must be')
    }

    await program.methods
      .initVerifierSet(K, new anchor.BN(BOND))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    const set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.equal(set.k, K)
    assert.equal(Number(set.bondAmount), BOND)
    assert.equal(set.members.length, 0)

    // The bond vault is the set's canonical USDC ATA (created externally,
    // the same pattern as the treasury). Owner is a PDA → allowOwnerOffCurve.
    bondVault = (await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, verifierSetPda, true))
      .address
  })

  it('Bonds two members into the set and refuses a duplicate join', async () => {
    verifierA = Keypair.generate()
    verifierB = Keypair.generate()
    await fund(verifierA.publicKey) // first vote pays the tally's rent
    await fund(verifierB.publicKey)
    verifierUsdcA = await createAccount(provider.connection, owner, usdcMint, verifierA.publicKey)
    verifierUsdcB = await createAccount(provider.connection, owner, usdcMint, verifierB.publicKey)
    await mintTo(provider.connection, owner, usdcMint, verifierUsdcA, owner, BOND)
    await mintTo(provider.connection, owner, usdcMint, verifierUsdcB, owner, BOND)

    await bondSeat(verifierA, verifierUsdcA)
    await bondSeat(verifierB, verifierUsdcB)

    try {
      await bondSeat(verifierA, verifierUsdcA)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already a bonded verifier')
    }

    const set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.deepEqual(
      set.members.map((m) => m.pubkey.toBase58()),
      [verifierA.publicKey.toBase58(), verifierB.publicKey.toBase58()],
    )
    const vault = await getAccount(provider.connection, bondVault)
    assert.equal(Number(vault.amount), 2 * BOND)
  })

  it('Reconfigures quorum and bond price, admin only', async () => {
    // A member cannot rewrite the rules — only config.admin.
    try {
      await program.methods
        .reconfigureVerifierSet(3, new anchor.BN(BOND))
        .accounts({
          authority: verifierA.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
        })
        .signers([verifierA])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    // Same bounds as init: k = 1 recreates the single-verifier regime.
    try {
      await program.methods
        .reconfigureVerifierSet(1, new anchor.BN(BOND))
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'Quorum must be')
    }

    // …and k above the set maximum is out just as at init.
    try {
      await program.methods
        .reconfigureVerifierSet(8, new anchor.BN(BOND))
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'Quorum must be')
    }

    // A zero bond would make seats free.
    try {
      await program.methods
        .reconfigureVerifierSet(K, new anchor.BN(0))
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'greater than zero')
    }

    // Valid in both directions: up to k = 3…
    await program.methods
      .reconfigureVerifierSet(3, new anchor.BN(REPRICED_BOND))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
      })
      .rpc()
    let set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.equal(set.k, 3)
    assert.equal(Number(set.bondAmount), REPRICED_BOND)

    // …and back to k = 2 for the vote tests below. The reconfiguration is
    // reversible, and repricing never moves the stakes existing seats posted.
    await program.methods
      .reconfigureVerifierSet(K, new anchor.BN(REPRICED_BOND))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
      })
      .rpc()
    set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.equal(set.k, K)
    assert.equal(Number(set.bondAmount), REPRICED_BOND)
    assert.deepEqual(
      set.members.map((m) => Number(m.stake)),
      [BOND, BOND],
    )
  })

  it('Reject voting by a key outside the verifier set', async () => {
    const stranger = Keypair.generate()
    await fund(stranger.publicKey) // pays tally init rent; the gate must still reject

    try {
      await castVote(reportPda, true, stranger)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'authorised verifier')
    }
  })

  it('Approves a scout report only at quorum, one vote per member', async () => {
    // One bonded vote with k=2: still pending — a single key can no longer
    // verify a report on its own.
    await castVote(reportPda, true, verifierA)
    const half = await program.account.scoutReport.fetch(reportPda)
    assert.deepEqual(half.status, { pending: {} })

    // The same member cannot vote twice while the tally is open.
    try {
      await castVote(reportPda, true, verifierA)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already voted')
    }

    // The second bonded member's vote reaches quorum and finalizes.
    await castVote(reportPda, true, verifierB)
    const reportAccount = await program.account.scoutReport.fetch(reportPda)
    assert.deepEqual(reportAccount.status, { verified: {} })
    assert.equal(reportAccount.verifier.toBase58(), verifierB.publicKey.toBase58())

    // Farm counter preserved from the old single-verifier path.
    const farmAccount = await program.account.farm.fetch(farmPda)
    assert.equal(farmAccount.verifiedReportCount, 1)

    // The tally keeps both votes for audit.
    const tally = await program.account.tally.fetch(tallyFor(reportPda))
    assert.equal(tally.approvals, 2)
    assert.equal(tally.rejections, 0)
    assert.equal(tally.votes.length, 2)
  })

  it('Reject voting on an already-verified report', async () => {
    try {
      await castVote(reportPda, true, verifierA)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already verified or rejected')
    }
  })

  it('Reward a verified report', async () => {
    const vaultBefore = await getAccount(provider.connection, rewardVault)
    const reporterBefore = await getAccount(provider.connection, reporterTokenAccount)

    // Permissionless since the gates moved: the Verified status is the only
    // gate, and REPORT_REWARD (== REWARD_AMOUNT) is protocol-fixed.
    await program.methods
      .rewardReport()
      .accounts({
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

    // Try to reward without a quorum approval
    try {
      await program.methods
        .rewardReport()
        .accounts({
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

  it('Rejects a scout report at quorum', async () => {
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

    // Reject it: two bonded no-votes reach quorum. Rejection does not bump
    // the farm's verified count — only approvals do.
    await castVote(report3Pda, false, verifierA)
    await castVote(report3Pda, false, verifierB)

    const reportAccount = await program.account.scoutReport.fetch(report3Pda)
    assert.deepEqual(reportAccount.status, { rejected: {} })
    assert.equal(reportAccount.verifier.toBase58(), verifierB.publicKey.toBase58())
    const farmAccount = await program.account.farm.fetch(farmPda)
    assert.equal(farmAccount.verifiedReportCount, 1)
  })

  it('Refuses an exit that would drop the set below quorum', async () => {
    // Members [A, B] at k = 2: the set sits exactly on the floor, so a
    // voluntary exit would strand quorum — refused with nothing moved.
    try {
      await program.methods
        .removeVerifier()
        .accounts({
          member: verifierA.publicKey,
          verifierSet: verifierSetPda,
          bondVault,
          usdcMint,
          memberUsdc: verifierUsdcA,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([verifierA])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'below its quorum')
    }

    const set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.equal(set.members.length, 2)
    const vault = await getAccount(provider.connection, bondVault)
    assert.equal(Number(vault.amount), 2 * BOND)
  })

  it('Bonds a third seat at the current price, then exits above the floor', async () => {
    verifierC = Keypair.generate()
    await fund(verifierC.publicKey)
    verifierUsdcC = await createAccount(provider.connection, owner, usdcMint, verifierC.publicKey)
    await mintTo(provider.connection, owner, usdcMint, verifierUsdcC, owner, REPRICED_BOND)

    // C is the first seat to join after the reconfiguration: they pay the
    // CURRENT price (7), while A and B keep the 5 they posted.
    await bondSeat(verifierC, verifierUsdcC)
    let set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.deepEqual(
      set.members.map((m) => [m.pubkey.toBase58(), Number(m.stake)]),
      [
        [verifierA.publicKey.toBase58(), BOND],
        [verifierB.publicKey.toBase58(), BOND],
        [verifierC.publicKey.toBase58(), REPRICED_BOND],
      ],
    )
    let vault = await getAccount(provider.connection, bondVault)
    assert.equal(Number(vault.amount), 2 * BOND + REPRICED_BOND)

    // Three members at k = 2: A exits above the floor and gets back exactly
    // the stake they posted — 5, not the reconfigured 7.
    const before = (await getAccount(provider.connection, verifierUsdcA)).amount
    await program.methods
      .removeVerifier()
      .accounts({
        member: verifierA.publicKey,
        verifierSet: verifierSetPda,
        bondVault,
        usdcMint,
        memberUsdc: verifierUsdcA,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([verifierA])
      .rpc()

    const after = (await getAccount(provider.connection, verifierUsdcA)).amount
    assert.equal(Number(after), Number(before) + BOND)
    vault = await getAccount(provider.connection, bondVault)
    assert.equal(Number(vault.amount), BOND + REPRICED_BOND)
    set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.deepEqual(
      set.members.map((m) => [m.pubkey.toBase58(), Number(m.stake)]),
      [
        [verifierB.publicKey.toBase58(), BOND],
        [verifierC.publicKey.toBase58(), REPRICED_BOND],
      ],
    )
  })

  it('Releases a seat with the bond returned, admin only', async () => {
    // A member cannot release anyone — only config.admin.
    try {
      await program.methods
        .releaseVerifier(verifierC.publicKey)
        .accounts({
          authority: verifierB.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
          bondVault,
          usdcMint,
          memberUsdc: verifierUsdcC,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([verifierB])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    const before = (await getAccount(provider.connection, verifierUsdcC)).amount
    await program.methods
      .releaseVerifier(verifierC.publicKey)
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
        bondVault,
        usdcMint,
        memberUsdc: verifierUsdcC,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc()

    // C's recorded stake went back to C's own account — even though the set
    // now stands BELOW k: release is governance's unconditional valve, the
    // counterpart to the (floored) voluntary exit.
    const after = (await getAccount(provider.connection, verifierUsdcC)).amount
    assert.equal(Number(after), Number(before) + REPRICED_BOND)
    const vault = await getAccount(provider.connection, bondVault)
    assert.equal(Number(vault.amount), BOND)
    const set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.deepEqual(
      set.members.map((m) => [m.pubkey.toBase58(), Number(m.stake)]),
      [[verifierB.publicKey.toBase58(), BOND]],
    )
  })

  it('Slash moves a bond to the treasury, admin only', async () => {
    // A member cannot slash — only config.admin.
    try {
      await program.methods
        .slashVerifier(verifierB.publicKey)
        .accounts({
          authority: verifierB.publicKey,
          config: configPda,
          verifierSet: verifierSetPda,
          treasury: treasuryPda,
          bondVault,
          treasuryUsdc,
          usdcMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([verifierB])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    const treasuryBefore = (await getAccount(provider.connection, treasuryUsdc)).amount

    await program.methods
      .slashVerifier(verifierB.publicKey)
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
        treasury: treasuryPda,
        bondVault,
        treasuryUsdc,
        usdcMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc()

    const set = await program.account.verifierSet.fetch(verifierSetPda)
    assert.equal(set.members.length, 0)
    const vault = await getAccount(provider.connection, bondVault)
    assert.equal(Number(vault.amount), 0)
    const treasuryAfter = (await getAccount(provider.connection, treasuryUsdc)).amount
    // +BOND (B's recorded 5 USDC) — not the reconfigured 7: the slash takes
    // exactly the stake this seat posted, and may leave the set below k by
    // design (governance's unconditional lever).
    assert.equal(Number(treasuryAfter), Number(treasuryBefore) + BOND)
  })

  it('Freezes an open tally when k is lowered beneath it', async () => {
    // Everyone's seat is free again (A exited, B was slashed, C was
    // released) — rebuild a three-member set and re-quorum it to 3.
    await program.methods
      .reconfigureVerifierSet(3, new anchor.BN(REPRICED_BOND))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
      })
      .rpc()

    for (const [by, usdc] of [
      [verifierA, verifierUsdcA],
      [verifierB, verifierUsdcB],
      [verifierC, verifierUsdcC],
    ] as const) {
      await mintTo(provider.connection, owner, usdcMint, usdc, owner, REPRICED_BOND)
      await bondSeat(by, usdc)
    }

    // A fresh report — its tally opens on the first vote below.
    const [report4Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), u32le(3)],
      program.programId,
    )
    await program.methods
      .submitScoutReport(PHOTO_HASH, REPORT_URI, new anchor.BN(LAT_E6), new anchor.BN(LNG_E6), AI_LABEL)
      .accounts({
        reporter: reporter.publicKey,
        farm: farmPda,
        report: report4Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([reporter])
      .rpc()

    // Two approvals with k = 3: still open.
    await castVote(report4Pda, true, verifierA)
    await castVote(report4Pda, true, verifierB)
    const open = await program.account.scoutReport.fetch(report4Pda)
    assert.deepEqual(open.status, { pending: {} })

    // Governance lowers k beneath the standing tally…
    await program.methods
      .reconfigureVerifierSet(K, new anchor.BN(REPRICED_BOND))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
      })
      .rpc()

    // …and the next member contact freezes it as the counts already stand:
    // quorum (2) was reached under the new k, so C's ballot is never
    // recorded — no AlreadyVoted deadlock, no vote inflation.
    await castVote(report4Pda, true, verifierC)
    const frozen = await program.account.scoutReport.fetch(report4Pda)
    assert.deepEqual(frozen.status, { verified: {} })
    const tally = await program.account.tally.fetch(tallyFor(report4Pda))
    assert.equal(tally.approvals, 2)
    assert.equal(tally.votes.length, 2)
    const farmAccount = await program.account.farm.fetch(farmPda)
    assert.equal(farmAccount.verifiedReportCount, 2)
  })

  // ── Oracle set (Phase 2 — median of an odd quorum, no bonds) ──────────────

  it('Initialises the oracle set with an admin-only odd quorum of three', async () => {
    const stranger = Keypair.generate()
    await fund(stranger.publicKey) // init pays rent before the gate

    // Only config.admin sets the rules.
    try {
      await program.methods
        .initOracleSet(ORACLE_K)
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          oracleSet: oracleSetPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    // An even quorum has no unambiguous middle value to return.
    try {
      await program.methods
        .initOracleSet(2)
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          oracleSet: oracleSetPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'odd number')
    }

    // k=1 would recreate the single-reader regime Phase 2 removed.
    try {
      await program.methods
        .initOracleSet(1)
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          oracleSet: oracleSetPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'odd number')
    }

    await program.methods
      .initOracleSet(ORACLE_K)
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        oracleSet: oracleSetPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    const set = await program.account.oracleSet.fetch(oracleSetPda)
    assert.equal(set.k, ORACLE_K)
    assert.equal(set.members.length, 0)
  })

  it('Assigns three reader seats and refuses duplicates', async () => {
    oracleA = Keypair.generate()
    oracleB = Keypair.generate()
    oracleC = Keypair.generate()
    // The season's first reader also pays the tally's rent.
    await fund(oracleA.publicKey)

    const add = (member: PublicKey, by: PublicKey = provider.wallet.publicKey, signers: Keypair[] = []) =>
      program.methods
        .addOracle(member)
        .accounts({ authority: by, config: configPda, oracleSet: oracleSetPda })
        .signers(signers)
        .rpc()

    await add(oracleA.publicKey)
    await add(oracleB.publicKey)
    await add(oracleC.publicKey)

    // A seat cannot be taken twice.
    try {
      await add(oracleA.publicKey)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already a reader')
    }

    // A non-admin cannot assign seats.
    try {
      await add(oracleB.publicKey, verifierB.publicKey, [verifierB])
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    // Removal revokes a seat; a reading already posted would persist.
    await program.methods
      .removeOracle(oracleC.publicKey)
      .accounts({ authority: provider.wallet.publicKey, config: configPda, oracleSet: oracleSetPda })
      .rpc()
    let set = await program.account.oracleSet.fetch(oracleSetPda)
    assert.equal(set.members.length, 2)

    await add(oracleC.publicKey)
    set = await program.account.oracleSet.fetch(oracleSetPda)
    assert.equal(set.members.length, ORACLE_K)
  })

  it('Rejects a reading from outside the oracle set', async () => {
    const stranger = Keypair.generate()
    await fund(stranger.publicKey) // init_if_needed pays rent before the gate

    try {
      await program.methods
        .submitOracleReading(new anchor.BN(SEASON_START), RAINFALL_MM)
        .accounts({
          member: stranger.publicKey,
          oracleSet: oracleSetPda,
          farm: farmPda,
          oracle: oraclePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'authorised weather oracle')
    }
  })

  // ── Switchboard On-Demand receipts (Phase 3B — role-1, permissionless) ────

  const registerBinding = (
    signers: PublicKey[],
    by: PublicKey = provider.wallet.publicKey,
    signerKeys: Keypair[] = [],
    feedHash: number[] = SB_FEED_HASH,
  ) =>
    program.methods
      .registerSwitchboardFeed(new anchor.BN(SB_SEASON_START), SB_FEED, feedHash, signers)
      .accounts({
        authority: by,
        config: configPda,
        farm: farmPda,
        oracleSet: oracleSetPda,
        binding: sbBindingPda,
        systemProgram: SystemProgram.programId,
      })
      .signers(signerKeys)
      .rpc()

  it('Pins the feed binding only for a seated feed, an admin, and three keys', async () => {
    const stranger = Keypair.generate()
    await fund(stranger.publicKey) // init pays rent before the gate

    // The trust root cannot be pinned before the feed holds an oracle seat.
    try {
      await registerBinding(sbEnclaves.map((k) => k.publicKey))
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'authorised weather oracle')
    }

    await program.methods
      .addOracle(SB_FEED)
      .accounts({ authority: provider.wallet.publicKey, config: configPda, oracleSet: oracleSetPda })
      .rpc()

    // Only the config admin pins the quorum.
    try {
      await registerBinding(
        sbEnclaves.map((k) => k.publicKey),
        stranger.publicKey,
        [stranger],
      )
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'program admin')
    }

    // Fewer than three keys is not a quorum…
    try {
      await registerBinding(sbEnclaves.slice(0, 2).map((k) => k.publicKey))
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'three distinct signers')
    }

    // …and neither is three keys that are not distinct.
    try {
      await registerBinding([sbEnclaves[0].publicKey, sbEnclaves[0].publicKey, sbEnclaves[1].publicKey])
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'three distinct signers')
    }

    await registerBinding(sbEnclaves.map((k) => k.publicKey))
    const binding = await program.account.switchboardFeedBinding.fetch(sbBindingPda)
    assert.equal(binding.farm.toBase58(), farmPda.toBase58())
    assert.equal(Number(binding.seasonStart), SB_SEASON_START)
    assert.equal(binding.feed.toBase58(), SB_FEED.toBase58())
    assert.deepEqual(Array.from(binding.feedHash), SB_FEED_HASH)
    assert.equal(binding.signers.length, 3)

    // Re-running the registration is the rotation path — same seat, fresh
    // pins — and must leave the binding intact.
    await registerBinding(sbEnclaves.map((k) => k.publicKey))
    const again = await program.account.switchboardFeedBinding.fetch(sbBindingPda)
    assert.equal(again.signers.length, 3)
  })

  it('Refuses a receipt when the transaction carries no proof', async () => {
    const relayer = Keypair.generate()
    await fund(relayer.publicKey)

    try {
      await relayReceipt(await freshSlothash(), [], relayer, false)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'malformed')
    }
  })

  it('Refuses a receipt signed by keys the admin never pinned', async () => {
    const impostors = [Keypair.generate(), Keypair.generate(), Keypair.generate()]
    const relayer = Keypair.generate()
    await fund(relayer.publicKey)

    const message = receiptMessage(await freshSlothash(), SB_FEED_HASH, 22_200_000_000_000_000_000n)
    try {
      await relayReceipt(message, impostors, relayer)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'pinned enclave quorum')
    }
  })

  it('Refuses a receipt signed for a different job hash', async () => {
    const relayer = Keypair.generate()
    await fund(relayer.publicKey)

    const foreign = SB_FEED_HASH.map((byte, i) => (i === 0 ? byte ^ 0xff : byte))
    const message = receiptMessage(await freshSlothash(), foreign, 22_200_000_000_000_000_000n)
    try {
      await relayReceipt(message, sbEnclaves, relayer)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'malformed')
    }
  })

  it('Refuses a receipt whose slothash left the recent window', async () => {
    const relayer = Keypair.generate()
    await fund(relayer.publicKey)

    const message = receiptMessage(Buffer.alloc(32, 0xee), SB_FEED_HASH, 22_200_000_000_000_000_000n)
    try {
      await relayReceipt(message, sbEnclaves, relayer)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'stale')
    }
  })

  it('Refuses a value that is not a whole 0.1 mm of rainfall', async () => {
    const relayer = Keypair.generate()
    await fund(relayer.publicKey)

    // 22.15 mm sits between two 0.1 mm ticks — the job's scale cannot carry it.
    const message = receiptMessage(await freshSlothash(), SB_FEED_HASH, 22_150_000_000_000_000_000n)
    try {
      await relayReceipt(message, sbEnclaves, relayer)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'whole 0.1 mm')
    }
  })

  it('Relays a verified receipt permissionlessly into the tally', async () => {
    const relayer = Keypair.generate() // not an admin, not a reader — the receipt is the authority
    await fund(relayer.publicKey) // it pays only for the tally this season has not created

    await relayReceipt(
      receiptMessage(await freshSlothash(), SB_FEED_HASH, 22_200_000_000_000_000_000n),
      sbEnclaves,
      relayer,
    )

    const tally = await program.account.weatherOracle.fetch(sbTallyPda)
    assert.equal(tally.farm.toBase58(), farmPda.toBase58())
    assert.equal(Number(tally.seasonStart), SB_SEASON_START)
    assert.equal(tally.readings.length, 1)
    assert.equal(tally.readings[0].oracle.toBase58(), SB_FEED.toBase58())
    assert.equal(tally.readings[0].totalRainfallMm, 222) // 22.2 mm
    assert.isFalse(tally.finalized)
  })

  it('Freezes the receipt into the median once the seat quorum lands', async () => {
    await submitReading(oracleA, 500, SB_SEASON_START, sbTallyPda)
    let tally = await program.account.weatherOracle.fetch(sbTallyPda)
    assert.equal(tally.readings.length, 2)
    assert.isFalse(tally.finalized)

    await submitReading(oracleB, 700, SB_SEASON_START, sbTallyPda)
    tally = await program.account.weatherOracle.fetch(sbTallyPda)
    assert.isTrue(tally.finalized)
    // [222, 500, 700] → median 500 — a mean would be 474.
    assert.equal(tally.totalRainfallMm, 500)
    assert.equal(tally.readings.length, 3)

    // A late receipt from valid enclaves cannot move a settled number.
    const late = Keypair.generate()
    await fund(late.publicKey)
    try {
      await relayReceipt(
        receiptMessage(await freshSlothash(), SB_FEED_HASH, 99_900_000_000_000_000_000n),
        sbEnclaves,
        late,
      )
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already final')
    }
  })

  it('Re-pins the enclave set when the queue rotates its keys', async () => {
    const rotated = [Keypair.generate(), Keypair.generate(), Keypair.generate()]
    await registerBinding(rotated.map((k) => k.publicKey))

    const binding = await program.account.switchboardFeedBinding.fetch(sbBindingPda)
    assert.deepEqual(
      binding.signers.map((k) => k.toBase58()),
      rotated.map((k) => k.publicKey.toBase58()),
    )

    // The old keys are revoked the moment the admin re-pins.
    const late = Keypair.generate()
    await fund(late.publicKey)
    try {
      await relayReceipt(
        receiptMessage(await freshSlothash(), SB_FEED_HASH, 22_200_000_000_000_000_000n),
        sbEnclaves,
        late,
      )
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'pinned enclave quorum')
    }
  })

  // ── Treasury-pool insurance ────────────────────────────────────────────────

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

  it('Revoke returns the premium and sweeps coverage into the program treasury', async () => {
    // A second policy with a still-running season (revoke refuses after
    // season_end), so the main index-0 policy stays untouched for settling.
    const futureEnd = Math.floor(Date.now() / 1000) + 30 * 86_400
    const [policy2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('policy'), farmPda.toBuffer(), u32le(1)],
      program.programId,
    )
    const [vault2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('insurance_vault'), farmPda.toBuffer(), u32le(1)],
      program.programId,
    )
    const adminWallet = (provider.wallet as anchor.Wallet).payer

    await program.methods
      .createPolicy(
        'maize',
        new anchor.BN(COVERAGE),
        new anchor.BN(PREMIUM),
        THRESHOLD_MM,
        new anchor.BN(SEASON_START),
        new anchor.BN(futureEnd),
      )
      .accounts({
        farmer: owner.publicKey,
        farm: farmPda,
        policy: policy2Pda,
        insuranceVault: vault2Pda,
        farmerUsdc: ownerUsdc,
        usdcMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc()
    await transfer(provider.connection, adminWallet, adminUsdc, vault2Pda, adminWallet, COVERAGE)

    const farmerBefore = (await getAccount(provider.connection, ownerUsdc)).amount
    const treasuryBefore = (await getAccount(provider.connection, treasuryUsdc)).amount

    await program.methods
      .revokePolicy()
      .accounts({
        farmer: owner.publicKey,
        policy: policy2Pda,
        insuranceVault: vault2Pda,
        farmerUsdc: ownerUsdc,
        treasury: treasuryPda,
        insurerUsdc: treasuryUsdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc()

    // Premium back to the farmer, coverage into program custody, both
    // policy-side accounts closed (rents to the farmer).
    const farmerAfter = (await getAccount(provider.connection, ownerUsdc)).amount
    assert.equal(Number(farmerAfter), Number(farmerBefore) + PREMIUM)
    const treasuryAfter = (await getAccount(provider.connection, treasuryUsdc)).amount
    assert.equal(Number(treasuryAfter), Number(treasuryBefore) + COVERAGE)
    assert.isNull(await program.account.policy.fetchNullable(policy2Pda))
    let vault2Closed = false
    try {
      await getAccount(provider.connection, vault2Pda)
    } catch {
      vault2Closed = true
    }
    assert.isTrue(vault2Closed)
  })

  it('Withdraws from the program treasury as the admin and refuses anyone else', async () => {
    const AMOUNT = 10_000_000 // 10 USDC of the swept refunds
    const stranger = Keypair.generate()

    try {
      await program.methods
        .withdrawTreasury(new anchor.BN(AMOUNT))
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          treasury: treasuryPda,
          treasuryUsdc,
          destinationUsdc: adminUsdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([stranger])
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'authorised program admin')
    }

    const treasuryBefore = (await getAccount(provider.connection, treasuryUsdc)).amount
    const adminBefore = (await getAccount(provider.connection, adminUsdc)).amount

    await program.methods
      .withdrawTreasury(new anchor.BN(AMOUNT))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        treasury: treasuryPda,
        treasuryUsdc,
        destinationUsdc: adminUsdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc()

    const treasuryAfter = (await getAccount(provider.connection, treasuryUsdc)).amount
    const adminAfter = (await getAccount(provider.connection, adminUsdc)).amount
    assert.equal(Number(treasuryAfter), Number(treasuryBefore) - AMOUNT)
    assert.equal(Number(adminAfter), Number(adminBefore) + AMOUNT)
  })

  it('Keeps the season reading open until quorum', async () => {
    // One of three readers: stored in the tally, nothing official yet.
    await submitReading(oracleA, 700)
    const partial = await program.account.weatherOracle.fetch(oraclePda)
    assert.isFalse(partial.finalized)
    assert.equal(partial.totalRainfallMm, 0)
    assert.equal(partial.readings.length, 1)

    // Settle refuses a partial tally — the account existing is not quorum.
    try {
      await program.methods
        .settlePolicy()
        .accounts({
          settler: provider.wallet.publicKey,
          config: configPda,
          policy: policyPda,
          insuranceVault: policyVault,
          oracle: oraclePda,
          farmerUsdc: ownerUsdc,
          treasury: treasuryPda,
          insurerUsdc: treasuryUsdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc()
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'has not reached quorum')
    }
  })

  it('Replaces its own reading before quorum (never double-counts)', async () => {
    // The same reader corrects 70.0 mm → 60.0 mm while the tally is open.
    await submitReading(oracleA, 600)
    const tally = await program.account.weatherOracle.fetch(oraclePda)
    assert.equal(tally.readings.length, 1)
    assert.equal(tally.readings[0].totalRainfallMm, 600)
    assert.equal(tally.readings[0].oracle.toBase58(), oracleA.publicKey.toBase58())
    assert.isFalse(tally.finalized)
  })

  it('Post the season reading and reject a refund to a non-treasury account', async () => {
    // Complete the quorum: [600, 800, 900] → median 800 (a mean would be
    // 766.7 — the median, not the average, is what settles).
    await submitReading(oracleB, 800)
    await submitReading(oracleC, 900)

    const oracle = await program.account.weatherOracle.fetch(oraclePda)
    assert.isTrue(oracle.finalized)
    assert.equal(oracle.totalRainfallMm, RAINFALL_MM)
    assert.equal(oracle.readings.length, ORACLE_K)
    assert.isAbove(Number(oracle.readingTimestamp), 0)

    // A late reader cannot move a settled number.
    try {
      await submitReading(oracleA, 123)
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.include(err.message, 'already final')
    }

    // Refund destination owned by the farmer, not the treasury → rejected.
    try {
      await program.methods
        .settlePolicy()
        .accounts({
          settler: provider.wallet.publicKey,
          config: configPda,
          policy: policyPda,
          insuranceVault: policyVault,
          oracle: oraclePda,
          farmerUsdc: ownerUsdc,
          treasury: treasuryPda,
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
    const treasuryBefore = (await getAccount(provider.connection, treasuryUsdc)).amount

    await program.methods
      .settlePolicy()
      .accounts({
        settler: provider.wallet.publicKey,
        config: configPda,
        policy: policyPda,
        insuranceVault: policyVault,
        oracle: oraclePda,
        farmerUsdc: ownerUsdc,
        treasury: treasuryPda,
        insurerUsdc: treasuryUsdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc()

    const settled = await program.account.policy.fetch(policyPda)
    assert.deepEqual(settled.state, { expired: {} })

    // The coverage lands in the program-owned treasury, not the admin's wallet.
    const treasuryAfter = (await getAccount(provider.connection, treasuryUsdc)).amount
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
