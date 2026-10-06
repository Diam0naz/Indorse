/**
 * scripts/devnet-lifecycle.cjs — the Phase 1/3A lifecycle rehearsal on a real
 * cluster. The integration suite proves these paths against a fresh localnet;
 * this script proves them against the deployed devnet state — in particular
 * the one transition localnet can never reproduce: the FIRST join on an
 * account allocated by the pre-Phase-3A program, which must realloc the
 * verifier set from its old bare-pubkey layout (246 bytes) to the current
 * member-with-stake layout (302) while an empty Vec decodes identically
 * under both.
 *
 * The arc (each step is guarded by on-chain state, so a re-run after a
 * mid-run RPC failure resumes instead of double-spending):
 *
 *   1  fund three deterministic seats + farm owner + reporter
 *   2  seat-a joins        → REALLOC 246 → 302 fires, stake recorded 5 USDC
 *   3  seat-b joins        → set stands at k members (floor engages)
 *   4  seat-a self-exit    → REFUSED (DropBelowQuorum)
 *   5  farm + report-1
 *   6  seat-a, seat-b approve → report-1 Verified at quorum, farm count 1
 *   7  admin reconfigure   → k 2→3, bond 5→7 USDC (governed reprice)
 *   8  seat-c joins at 7   → recorded stake 7 while a/b keep 5
 *   9  seat-c self-exit    → REFUSED (3 members, k=3)
 *  10  report-2; a, b approve → open tally at 2/3 under k=3
 *  11  admin reconfigure   → k 3→2 beneath the open tally
 *  12  seat-c approve      → FREEZE: finalises without recording c's ballot
 *  13  seat-c self-exit    → allowed (3 > 2), refunded its RECORDED 7 USDC
 *  14  admin release b     → b refunded 5, set drops to 1 member (the valve)
 *  15  seat-b rejoins      → at the CURRENT price of 7 (reprice affects joins)
 *
 *   Final state: k=2, bond 7 USDC, members [a@5, b@7], vault 12 USDC,
 *   both reports Verified (report-2 via freeze), farm.verified=2.
 *
 * NOT covered: reward_report — there is no reward vault on devnet (the
 * reward_authority PDA holds no token accounts), and inventing a reward
 * mint here just to tick the box would be theatre. Documented as a gap.
 *
 * Seats/owner/reporter derive from a public seed like the role keys — they
 * are structural, not secret (see scripts/role-keys.cjs). Bootstrap wallet
 * signs every fee and rent payment; each seat pays only the rent it is the
 * payer of (the realloc delta, the first tally).
 *
 *   node scripts/devnet-lifecycle.cjs            # devnet (default)
 *   RPC_URL=http://127.0.0.1:8899 node scripts/devnet-lifecycle.cjs
 *
 * USDC_MINT overrides the bond mint (must match the existing bond vault).
 */
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert')
const anchor = require('@coral-xyz/anchor')
const {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} = require('@solana/spl-token')
const { pickAdminSigner } = require('./role-keys.cjs')

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const KEY_PATH = process.env.SOLANA_KEYPAIR ?? join(homedir(), '.config/solana/id.json')
const IDL = require(resolve(__dirname, '../../../lib/idl/indorse_program.json'))
const SEED = process.env.REHEARSAL_SEED ?? 'indorse-devnet-rehearsal-v1'

const OLD_SET_SIZE = 246 // 8 + pre-Phase-3A VerifierSet (bare pubkeys)
const CURRENT_SET_SIZE = 8 + 294 // 8 + VerifierSet::MAX_SIZE today
const BOND_1 = new anchor.BN(5_000_000) // 5 USDC — the deployed rules
const BOND_2 = new anchor.BN(7_000_000) // 7 USDC — the governed reprice
const USDC = (n) => n / 1_000_000

const seat = (role) => anchor.web3.Keypair.fromSeed(createHash('sha256').update(`${SEED}:${role}`).digest())
const A = seat('seat-a')
const B = seat('seat-b')
const C = seat('seat-c')
const OWNER = seat('farm-owner')
const REPORTER = seat('scout')

const PHOTOS = {
  // Content-addressed placeholders: a real photo hash is 32 bytes of digest.
  1: createHash('sha256').update(`${SEED}:report-1`).digest(),
  2: createHash('sha256').update(`${SEED}:report-2`).digest(),
}

async function main() {
  const secret = Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8')))
  const bootstrap = anchor.web3.Keypair.fromSecretKey(secret)
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(bootstrap), {
    commitment: 'confirmed',
  })
  const program = new anchor.Program(IDL, provider)
  const usdcMint = new anchor.web3.PublicKey(process.env.USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  const [setPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('verifier_set')], program.programId)
  const bondVault = getAssociatedTokenAddressSync(usdcMint, setPda, true)
  const u32le = (n) => new anchor.BN(n).toArrayLike(Buffer, 'le', 4)
  const farmAt = (index) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('farm'), OWNER.publicKey.toBuffer(), u32le(index)],
      program.programId,
    )[0]
  const [counterPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('farm_counter'), OWNER.publicKey.toBuffer()],
    program.programId,
  )
  // Multi-farm roster: reuse the first farm already seated on the counter's
  // slots (the counter never decrements, so a live farm always sits inside
  // 0…count-1), or prepare the next free slot for registration.
  const counter = await program.account.farmCounter.fetchNullable(counterPda)
  const count = counter ? counter.count : 0
  let farmPda = null
  for (let i = 0; i < count; i++) {
    const candidate = farmAt(i)
    if (await connection.getAccountInfo(candidate)) {
      farmPda = candidate
      break
    }
  }
  if (!farmPda) farmPda = farmAt(count)
  const reportPda = (index) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('report'), farmPda.toBuffer(), new anchor.BN(index).toArrayLike(Buffer, 'le', 4)],
      program.programId,
    )[0]
  const tallyPda = (report) =>
    anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('tally'), report.toBuffer()], program.programId)[0]

  // One retry on the flaky public endpoint; expected failures are asserted,
  // never retried into a pass.
  const send = async (label, fn) => {
    try {
      const sig = await fn()
      console.log(' ', label, sig)
      return sig
    } catch (err) {
      const text = `${err.message ?? ''} ${JSON.stringify(err.logs ?? '')}`
      if (/blockhash|timed out|429|Too Many Requests|fetch failed/i.test(text)) {
        console.log(' ! transient on', label, '— retrying once')
        const sig = await fn()
        console.log(' ', label, sig)
        return sig
      }
      throw new Error(`${label}: ${text}`)
    }
  }
  // A step that must fail: the error code IS the assertion.
  const expectFail = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      const text = `${err.message ?? ''} ${JSON.stringify(err.error ?? '')} ${(err.logs ?? []).join(' ')}`
      assert(text.includes('DropBelowQuorum'), `${label}: wrong error — ${text}`)
      console.log(' ', label, '→ REFUSED (DropBelowQuorum) as required')
      return
    }
    assert.fail(`${label}: the transaction SUCCEEDED but the quorum floor must refuse it`)
  }

  const fetchSet = () => program.account.verifierSet.fetch(setPda)
  const membersOf = (set) => set.members.map((m) => ({ pubkey: m.pubkey.toBase58(), stake: Number(m.stake) }))
  const isMember = (set, kp) => set.members.some((m) => m.pubkey.equals(kp.publicKey))
  const usdcBalance = async (owner) => {
    const addr = getAssociatedTokenAddressSync(usdcMint, owner.publicKey ?? owner, !owner.publicKey)
    try {
      return Number((await getAccount(connection, addr)).amount)
    } catch {
      return 0
    }
  }

  // ── preflight ──────────────────────────────────────────────────────────────
  const info = await connection.getAccountInfo(setPda)
  assert(info, `verifier set missing at ${setPda.toBase58()} — run scripts/init-config.cjs first`)
  let set = await fetchSet()
  const memberKeys = membersOf(set).map((m) => m.pubkey)
  const ours = [A, B, C].map((s) => s.publicKey.toBase58())
  assert(
    memberKeys.every((k) => ours.includes(k)),
    `verifier set holds seats from another run: ${memberKeys}`,
  )
  console.log('preflight', {
    dataLen: info.data.length,
    k: set.k,
    bond: USDC(Number(set.bondAmount)),
    members: memberKeys,
  })

  const admin = pickAdminSigner((await program.account.config.fetch(configPda)).admin.toBase58(), bootstrap)

  // ── 1. funding (idempotent tops; only non-members are topped up) ──────────
  const solTarget = {
    [A.publicKey.toBase58()]: 0.1,
    [B.publicKey.toBase58()]: 0.1,
    [C.publicKey.toBase58()]: 0.1,
    [OWNER.publicKey.toBase58()]: 0.05,
    [REPORTER.publicKey.toBase58()]: 0.1,
  }
  for (const [b58, target] of Object.entries(solTarget)) {
    const key = new anchor.web3.PublicKey(b58)
    if ((await connection.getBalance(key)) >= target * anchor.web3.LAMPORTS_PER_SOL) continue
    await send(`fund SOL ${b58.slice(0, 8)}`, async () => {
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: bootstrap.publicKey,
          toPubkey: key,
          lamports: Math.round(target * anchor.web3.LAMPORTS_PER_SOL),
        }),
      )
      const sig = await provider.sendAndConfirm(tx)
      await connection.confirmTransaction(sig, 'confirmed')
      return sig
    })
  }
  for (const kp of [A, B, C]) {
    if (isMember(set, kp)) continue // already posted; its money is in the vault
    const dest = getAssociatedTokenAddressSync(usdcMint, kp.publicKey)
    const balance = await usdcBalance(kp)
    if (balance >= Number(BOND_2)) continue // enough for any join in this arc
    await send(`fund USDC ${kp.publicKey.toBase58().slice(0, 8)}`, async () => {
      const ixs = []
      try {
        await getAccount(connection, dest)
      } catch {
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(bootstrap.publicKey, dest, kp.publicKey, usdcMint))
      }
      ixs.push(
        createTransferInstruction(
          getAssociatedTokenAddressSync(usdcMint, bootstrap.publicKey),
          dest,
          bootstrap.publicKey,
          Number(BOND_2),
        ),
      )
      const tx = new anchor.web3.Transaction().add(...ixs)
      const sig = await provider.sendAndConfirm(tx)
      await connection.confirmTransaction(sig, 'confirmed')
      return sig
    })
  }

  const bondSeat = (kp) =>
    program.methods
      .postBond()
      .accounts({
        member: kp.publicKey,
        verifierSet: setPda,
        bondVault,
        usdcMint,
        memberUsdc: getAssociatedTokenAddressSync(usdcMint, kp.publicKey),
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc()

  // ── 2/3. joins (the realloc proof on the first one) ────────────────────────
  for (const [label, kp, expected] of [
    ['join seat-a (realloc)', A, BOND_1],
    ['join seat-b', B, BOND_1],
  ]) {
    set = await fetchSet()
    if (isMember(set, kp)) {
      console.log(' ·', label, 'already joined')
      continue
    }
    const wasOldLayout = (await connection.getAccountInfo(setPda)).data.length === OLD_SET_SIZE
    await send(label, () => bondSeat(kp))
    set = await fetchSet()
    const grown = (await connection.getAccountInfo(setPda)).data.length
    if (wasOldLayout) {
      assert.strictEqual(grown, CURRENT_SET_SIZE, `realloc did not fire: dataLen stayed ${grown}`)
      console.log('  ✓ REALLOC', OLD_SET_SIZE, '→', grown, 'bytes on the first live join')
    }
    const record = set.members.find((m) => m.pubkey.equals(kp.publicKey))
    assert(record && record.stake.eq(expected), `recorded stake wrong for ${label}: ${record?.stake}`)
  }

  // ── 4. floor refuses a voluntary exit at k members ─────────────────────────
  set = await fetchSet()
  if (isMember(set, A) && set.members.length <= set.k) {
    await expectFail('floor: seat-a self-exit at k members', () =>
      program.methods
        .removeVerifier()
        .accounts({
          member: A.publicKey,
          verifierSet: setPda,
          bondVault,
          usdcMint,
          memberUsdc: getAssociatedTokenAddressSync(usdcMint, A.publicKey),
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([A])
        .rpc(),
    )
  }

  // ── 5. farm + report-1 ─────────────────────────────────────────────────────
  if (!(await connection.getAccountInfo(farmPda))) {
    await send('register farm', () =>
      program.methods
        .registerFarm('Lifecycle Rehearsal Farm', new anchor.BN(34_052_000), new anchor.BN(-118_243_000))
        .accounts({
          owner: OWNER.publicKey,
          farmCounter: counterPda,
          farm: farmPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([OWNER])
        .rpc(),
    )
  } else {
    console.log(' · farm already registered')
  }
  const submitReport = (index) =>
    program.methods
      .submitScoutReport(
        Array.from(PHOTOS[index + 1]),
        `https://example.com/rehearsal/report-${index}.jpg`,
        new anchor.BN(34_052_000),
        new anchor.BN(-118_243_000),
        'healthy_corn',
      )
      .accounts({
        reporter: REPORTER.publicKey,
        farm: farmPda,
        report: reportPda(index),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([REPORTER])
      .rpc()
  if (!(await connection.getAccountInfo(reportPda(0)))) {
    await send('submit report-1', () => submitReport(0))
  } else {
    console.log(' · report-1 already submitted')
  }

  // ── 6. quorum votes on report-1 (k=2: a + b finalise) ─────────────────────
  const castVote = (report, approve, kp) =>
    program.methods
      .castVote(approve)
      .accounts({
        voter: kp.publicKey,
        verifierSet: setPda,
        report,
        farm: farmPda,
        tally: tallyPda(report),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc()
  const voteThrough = async (report, voters, k, expectVerified = true) => {
    for (const kp of voters) {
      const status = await program.account.scoutReport.fetch(report)
      if (status.status.verified || status.status.rejected || status.status.rewarded) break
      let tallyVotes = []
      try {
        const tally = await program.account.tally.fetch(tallyPda(report))
        tallyVotes = tally.votes.map((v) => v.voter.toBase58())
      } catch {
        /* no tally yet */
      }
      if (tallyVotes.includes(kp.publicKey.toBase58())) continue
      await send(`vote ${kp.publicKey.toBase58().slice(0, 8)} on report`, () => castVote(report, true, kp))
    }
    const final = await program.account.scoutReport.fetch(report)
    if (expectVerified) assert(final.status.verified, `report did not reach Verified at k=${k}`)
    return final
  }
  set = await fetchSet()
  if (!(await program.account.scoutReport.fetch(reportPda(0))).status.verified) {
    await voteThrough(reportPda(0), [A, B], set.k)
  } else {
    console.log(' · report-1 already verified')
  }
  const farm = await program.account.farm.fetch(farmPda)
  assert(farm.verifiedReportCount >= 1, 'farm verified count not bumped')

  // ── 7. governed reconfiguration: k 2→3, bond 5→7 ───────────────────────────
  const reconfigure = (k, bond) =>
    program.methods
      .reconfigureVerifierSet(k, bond)
      .accounts({ authority: admin.publicKey, config: configPda, verifierSet: setPda })
      .signers([admin])
      .rpc()
  set = await fetchSet()
  if (set.k === 2 && set.bondAmount.eq(BOND_1)) {
    await send('reconfigure k 2→3, bond 5→7', () => reconfigure(3, BOND_2))
    set = await fetchSet()
    assert.strictEqual(set.k, 3)
    assert(set.bondAmount.eq(BOND_2))
    console.log('  ✓ rules rewritten under config.admin')
  } else {
    console.log(' · reconfiguration already applied', { k: set.k, bond: Number(set.bondAmount) })
  }

  // ── 8. seat-c joins at the new price (recorded stake 7 ≠ a/b's 5) ─────────
  set = await fetchSet()
  if (!isMember(set, C)) {
    await send('join seat-c at 7 USDC', () => bondSeat(C))
    set = await fetchSet()
  }
  const cStake = set.members.find((m) => m.pubkey.equals(C.publicKey))
  assert(cStake && cStake.stake.eq(BOND_2), `seat-c recorded stake should be 7, got ${cStake?.stake}`)
  for (const kp of [A, B]) {
    const record = set.members.find((m) => m.pubkey.equals(kp.publicKey))
    assert(record && record.stake.eq(BOND_1), `repricing moved ${kp.publicKey.toBase58()}'s recorded stake`)
  }
  console.log('  ✓ recorded stakes [a@5, b@5, c@7] — reprice touched future joins only')

  // ── 9. floor still refuses: 3 members, k=3 ─────────────────────────────────
  set = await fetchSet()
  if (isMember(set, C) && set.members.length <= set.k) {
    await expectFail('floor: seat-c self-exit at k members', () =>
      program.methods
        .removeVerifier()
        .accounts({
          member: C.publicKey,
          verifierSet: setPda,
          bondVault,
          usdcMint,
          memberUsdc: getAssociatedTokenAddressSync(usdcMint, C.publicKey),
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([C])
        .rpc(),
    )
  }

  // ── 10. report-2 opened at 2/3 under k=3 ───────────────────────────────────
  if (!(await connection.getAccountInfo(reportPda(1)))) {
    await send('submit report-2', () => submitReport(1))
  } else {
    console.log(' · report-2 already submitted')
  }
  set = await fetchSet()
  let report2 = await program.account.scoutReport.fetch(reportPda(1))
  if (!report2.status.verified && set.k === 3) {
    await voteThrough(reportPda(1), [A, B], 3, false)
    const tally = await program.account.tally.fetch(tallyPda(reportPda(1)))
    assert.strictEqual(tally.approvals, 2, 'tally should stand at 2 of 3')
    report2 = await program.account.scoutReport.fetch(reportPda(1))
    assert(report2.status.pending, 'tally must still be open under k=3')
    console.log('  ✓ open tally at 2/3 — report-2 waiting on the third seat')
  }

  // ── 11. lower k beneath the open tally ─────────────────────────────────────
  set = await fetchSet()
  report2 = await program.account.scoutReport.fetch(reportPda(1))
  if (report2.status.pending && set.k === 3) {
    await send('reconfigure k 3→2 under the open tally', () => reconfigure(2, BOND_2))
    console.log('  ✓ k lowered with report-2 still open')
  }

  // ── 12. freeze-on-contact: c's vote finalises WITHOUT recording c ─────────
  report2 = await program.account.scoutReport.fetch(reportPda(1))
  if (report2.status.pending) {
    set = await fetchSet()
    if (isMember(set, C)) {
      await send('freeze: seat-c vote after k lowered', () => castVote(reportPda(1), true, C))
    }
    report2 = await program.account.scoutReport.fetch(reportPda(1))
    assert(report2.status.verified, 'freeze did not finalise report-2')
    const tally = await program.account.tally.fetch(tallyPda(reportPda(1)))
    assert.strictEqual(
      tally.votes.length,
      2,
      `freeze must not record the caller's ballot — got ${tally.votes.length} votes`,
    )
    assert.strictEqual(tally.approvals, 2)
    console.log('  ✓ FREEZE: report-2 Verified, tally still holds only a+b (c finalised without voting)')
  } else {
    console.log(' · freeze step already exercised')
  }

  // ── 13. seat-c exits above the floor, refunded its RECORDED 7 ──────────────
  set = await fetchSet()
  if (isMember(set, C) && set.members.length > set.k) {
    const before = await usdcBalance(C)
    const vaultBefore = Number((await getAccount(connection, bondVault)).amount)
    await send('floor passes: seat-c self-exit (recorded stake refund)', () =>
      program.methods
        .removeVerifier()
        .accounts({
          member: C.publicKey,
          verifierSet: setPda,
          bondVault,
          usdcMint,
          memberUsdc: getAssociatedTokenAddressSync(usdcMint, C.publicKey),
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([C])
        .rpc(),
    )
    const after = await usdcBalance(C)
    const vaultAfter = Number((await getAccount(connection, bondVault)).amount)
    assert.strictEqual(after - before, Number(BOND_2), 'exit must refund the recorded 7, not the current price')
    assert.strictEqual(vaultBefore - vaultAfter, Number(BOND_2))
    console.log('  ✓ seat-c exited with its full recorded 7 USDC')
  }

  // ── 14. governed release: b leaves, set drops to 1 member (the valve) ──────
  set = await fetchSet()
  if (isMember(set, B) && set.members.length === 2 && set.k === 2) {
    const before = await usdcBalance(B)
    await send('release seat-b (valve below k)', () =>
      program.methods
        .releaseVerifier(B.publicKey)
        .accounts({
          authority: admin.publicKey,
          config: configPda,
          verifierSet: setPda,
          bondVault,
          usdcMint,
          memberUsdc: getAssociatedTokenAddressSync(usdcMint, B.publicKey),
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc(),
    )
    const after = await usdcBalance(B)
    assert.strictEqual(after - before, Number(BOND_1), "release must return exactly b's recorded 5 USDC")
    set = await fetchSet()
    assert.strictEqual(set.members.length, 1)
    assert(set.members[0].pubkey.equals(A.publicKey))
    console.log('  ✓ RELEASE: b refunded 5 USDC, set now 1 member < k=2 (governance may go under)')
  }

  // ── 15. b rejoins at the CURRENT price (7, not the 5 it posted before) ─────
  set = await fetchSet()
  if (!isMember(set, B) && set.members.length === 1 && set.k === 2 && set.bondAmount.eq(BOND_2)) {
    await send('rejoin seat-b at the current 7 USDC', () => bondSeat(B))
    set = await fetchSet()
  }

  // ── final assertions ───────────────────────────────────────────────────────
  set = await fetchSet()
  const final = membersOf(set)
  const vault = Number((await getAccount(connection, bondVault)).amount)
  const report1 = await program.account.scoutReport.fetch(reportPda(0))
  report2 = await program.account.scoutReport.fetch(reportPda(1))
  const finalFarm = await program.account.farm.fetch(farmPda)
  const dataLen = (await connection.getAccountInfo(setPda)).data.length

  assert.strictEqual(set.k, 2, 'final k')
  assert(set.bondAmount.eq(BOND_2), 'final bond price')
  assert.deepStrictEqual(
    final.map((m) => [m.pubkey, m.stake]),
    [
      [A.publicKey.toBase58(), Number(BOND_1)],
      [B.publicKey.toBase58(), Number(BOND_2)],
    ],
    'final membership with recorded stakes',
  )
  assert.strictEqual(vault, Number(BOND_1) + Number(BOND_2), 'final vault balance')
  assert.strictEqual(dataLen, CURRENT_SET_SIZE, 'final account layout')
  assert(report1.status.verified, 'report-1 Verified')
  assert(report2.status.verified, 'report-2 Verified')
  assert.strictEqual(finalFarm.verifiedReportCount, 2, 'farm verified count')
  assert.strictEqual(await usdcBalance(C), Number(BOND_2), 'seat-c holds its full refund')

  console.log('\nREHEARSAL COMPLETE — devnet end state:')
  console.log({ k: set.k, bond: USDC(Number(set.bondAmount)), members: final, vault: USDC(vault), dataLen })
  console.log({ report1: 'Verified', report2: 'Verified (freeze)', farmVerified: finalFarm.verifiedReportCount })
}

main().catch((err) => {
  console.error('\nREHEARSAL STOPPED —', err.message ?? err)
  console.error('Re-run the same command: every step is guarded by on-chain state and will resume.')
  process.exit(1)
})
