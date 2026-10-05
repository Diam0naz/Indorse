/**
 * scripts/switchboard-reading.cjs — devnet smoke for the role-1, permissionless
 * `submit_switchboard_reading` instruction: pull ONE fresh On-Demand job
 * receipt through a live devnet oracle gateway (bypassing crossbar, which is
 * DNS-dead), prove every signature offline against each oracle's ON-CHAIN
 * enclave signer, pin that trust root with the admin, relay the receipt as an
 * ordinary fee-payer, and read the value back out of the season tally.
 *
 * The job is byte-for-byte the standalone probe's fixed LA rainfall feed, so
 * the feed hash asserted below (`0x1e70…84623`) is the same one the job-spec
 * proof verified — this rehearsal closes the loop between "the receipt is
 * real" and "the protocol accepts it".
 *
 * Flow (each step guarded, so a re-run resumes instead of double-spending):
 *   1  seat the canonical quote account on the devnet oracle set (admin)
 *   2  request a fresh gateway receipt; decode + verify its Ed25519 precompile
 *      instruction (signatures, feed hash, on-chain enclave signers)
 *   3  register the binding (admin): farm/season/feed hash/pinned signers
 *   4  relay [ed25519 ix, submit_switchboard_reading] from the bootstrap wallet
 *   5  read the tally back: the value lands under the feed's seat, exactly
 *      `receipt_value ÷ 1e17` whole 0.1 mm units
 *
 * The Switchboard SDK comes from the probe workspace (it carries the
 * crossbar-free gateway flow): override with SWB_DEPS if the probe moved.
 *
 *   node scripts/switchboard-reading.cjs
 *   RPC_URL=http://127.0.0.1:8899 node scripts/switchboard-reading.cjs
 */
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const assert = require('node:assert')
const { createRequire } = require('node:module')
const anchor = require('@coral-xyz/anchor')
const { pickAdminSigner } = require('./role-keys.cjs')

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const KEY_PATH = process.env.SOLANA_KEYPAIR ?? join(homedir(), '.config/solana/id.json')
const SWB = process.env.SWB_DEPS ?? '/tmp/opencode/sb-jobspec/node_modules'
const PROBE_DIR = dirname(SWB)
const IDL = require(resolve(__dirname, '../../../lib/idl/indorse_program.json'))

// Bare specifiers must resolve from the probe workspace: the Switchboard
// packages ship only an `exports` map (no usable `main`), which path-based
// requires bypass.
const probeRequire = createRequire(join(PROBE_DIR, 'probe-entry.js'))
const sb = probeRequire('@switchboard-xyz/on-demand')
const { OracleJob, CrossbarClient, FeedHash, Gateway } = probeRequire('@switchboard-xyz/common')
const nacl = probeRequire('tweetnacl')

const SEED = process.env.REHEARSAL_SEED ?? 'indorse-devnet-rehearsal-v1'
const SEASON = 1_711_920_000 // the rehearsal season (fixed past season)
const UNIT = 100_000_000_000_000_000n // 1e17 — the job's 18-dec value → 0.1 mm
const EXPECTED_FEED_HASH = '1e70a1ea0099fc2c5146d332ecd10824ba421cc2480ba74828640e94f3f84623'
const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111'
const NUM_SIGS = 3

// The probe's fixed job: 183 daily precipitation sums for one LA season.
// SUM aggregation is rejected by the deployed oracle build, so the total is
// mean(183) × 183 — the same workaround the standalone proof documented.
const OPEN_METEO_URL =
  'https://archive-api.open-meteo.com/v1/archive?latitude=34.052&longitude=-118.243' +
  '&start_date=2024-04-01&end_date=2024-09-30&daily=precipitation_sum&timezone=UTC'
const job = OracleJob.fromObject({
  tasks: [
    { httpTask: { url: OPEN_METEO_URL } },
    {
      meanTask: {
        tasks: Array.from({ length: 183 }, (_, i) => ({
          jsonParseTask: { path: `$.daily.precipitation_sum[${i}]` },
        })),
      },
    },
    { multiplyTask: { scalar: 183 } },
  ],
})
const feed = {
  name: 'LA-farm-cumulative-rainfall-2024-04-01_2024-09-30',
  jobs: [job],
  minOracleSamples: NUM_SIGS,
  minJobResponses: 1,
  maxJobRangePct: 1_000_000_000,
}

const seat = (role) => anchor.web3.Keypair.fromSeed(createHash('sha256').update(`${SEED}:${role}`).digest())
const i64le = (n) => new anchor.BN(n).toArrayLike(Buffer, 'le', 8)

/** Parse an Ed25519 precompile instruction's (signer, message) triples. */
function decodeEd25519(ix) {
  const data = Buffer.from(ix.data)
  const n = data[0]
  assert.ok(data.length >= 2 + n * 14, 'ed25519 ix truncated header')
  const at = (o) => data.readUInt16LE(o)
  const triples = []
  let message = null
  for (let i = 0; i < n; i++) {
    const base = 2 + i * 14
    const sigOff = at(base)
    const pkOff = at(base + 4)
    const msgOff = at(base + 8)
    const msgSize = at(base + 10)
    const msg = data.subarray(msgOff, msgOff + msgSize)
    if (message) assert.ok(msg.equals(message), 'signers disagree on the message')
    else message = msg
    triples.push({
      signature: data.subarray(sigOff, sigOff + 64),
      pubkey: data.subarray(pkOff, pkOff + 32),
      message: msg,
    })
  }
  return { n, message, triples }
}

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed')
  const bootstrap = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8'))))
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(bootstrap), {
    commitment: 'confirmed',
  })
  const program = new anchor.Program(IDL, provider)
  console.log(`rpc: ${RPC_URL}`)
  console.log(`wallet: ${bootstrap.publicKey.toBase58()}`)

  // ── derive everything structural ──────────────────────────────────────────
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  const [oracleSetPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('oracle_set')], program.programId)
  const OWNER = seat('farm-owner')
  const farmPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('farm'), OWNER.publicKey.toBuffer()],
    program.programId,
  )[0]
  assert.ok(await connection.getAccountInfo(farmPda), 'rehearsal farm missing — run devnet-lifecycle.cjs first')

  // ── the job: feed hash + canonical quote account (no crossbar needed) ─────
  const sbProgram = await sb.AnchorUtils.loadProgramFromConnection(connection, undefined, sb.ON_DEMAND_DEVNET_PID)
  const queue = await sb.Queue.loadDefault(sbProgram)
  const feedHashBuf = FeedHash.computeOracleFeedId(feed)
  assert.strictEqual(feedHashBuf.toString('hex'), EXPECTED_FEED_HASH, 'feed hash drifted from the probe job')
  const [quoteAccount] = sb.OracleQuote.getCanonicalPubkey(queue.pubkey, ['0x' + feedHashBuf.toString('hex')])
  console.log(`queue: ${queue.pubkey.toBase58()}`)
  console.log(`feed hash: 0x${feedHashBuf.toString('hex')}`)
  console.log(`quote account (feed seat): ${quoteAccount.toBase58()}`)

  const bindingPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('sb_feed'), farmPda.toBuffer(), i64le(SEASON), quoteAccount.toBuffer()],
    program.programId,
  )[0]
  const tallyPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('weather'), farmPda.toBuffer(), i64le(SEASON)],
    program.programId,
  )[0]

  // ── 1. the feed must hold an oracle-set seat before it can be pinned ──────
  const config = await program.account.config.fetch(configPda)
  const adminSigner = pickAdminSigner(config.admin.toBase58(), bootstrap)
  const oracleSet = await program.account.oracleSet.fetch(oracleSetPda)
  if (!oracleSet.members.some((m) => m.equals(quoteAccount))) {
    console.log('seating the quote account on the devnet oracle set (admin)…')
    await program.methods
      .addOracle(quoteAccount)
      .accounts({ authority: adminSigner.publicKey, config: configPda, oracleSet: oracleSetPda })
      .signers([adminSigner])
      .rpc()
    console.log('  seated')
  } else {
    console.log('quote account already seated')
  }

  // ── 2. one fresh receipt from a live gateway (crossbar is DNS-dead) ───────
  const oracleRows = JSON.parse(readFileSync(join(PROBE_DIR, 'oracles.json'), 'utf8'))
  const uris = [...new Set(oracleRows.map((r) => r.uri).filter(Boolean))]
  let gatewayUrl = null
  for (const u of uris) {
    try {
      const r = await fetch(`${u}/gateway/api/v1/test`, { signal: AbortSignal.timeout(7000) })
      if (r.ok) {
        gatewayUrl = u
        break
      }
    } catch {}
  }
  if (!gatewayUrl) throw new Error('no healthy devnet gateway found')
  console.log(`gateway: ${gatewayUrl}`)

  const gateway = new Gateway(gatewayUrl)
  let receipt = null
  const origFetch = gateway.fetchSignaturesConsensus.bind(gateway)
  gateway.fetchSignaturesConsensus = async (params) => {
    const resp = await origFetch(params)
    receipt = resp
    return resp
  }
  // The only crossbar call in the SDK path is fetchGateway().
  const crossbar = CrossbarClient.default()
  crossbar.fetchGateway = async () => gateway

  // Consensus rounds do not always reach 3 signers; retry until they do —
  // the protocol requires max(3, min_oracle_samples) distinct pinned keys to
  // have signed the SAME message.
  let ed25519Ix = null
  let message = null
  let n = 0
  let distinctSigners = null
  for (let attempt = 1; attempt <= 6 && !ed25519Ix; attempt++) {
    receipt = null
    const ixs = await queue.fetchManagedUpdateIxs(crossbar, [feed], {
      numSignatures: NUM_SIGS,
      payer: bootstrap.publicKey,
      instructionIdx: 0, // absolute index: our tx puts the precompile first
    })
    assert.ok(receipt, 'gateway receipt was not captured')
    const sdkIx = ixs.find((i) => i.programId.toBase58() === ED25519_PROGRAM)
    assert.ok(sdkIx, 'managed update carried no Ed25519 precompile instruction')

    // Reclass the instruction through OUR web3.js classes (the SDK bundles
    // its own copy) so the transaction builder sees one consistent type.
    const ix = new anchor.web3.TransactionInstruction({
      programId: new anchor.web3.PublicKey(sdkIx.programId.toBase58()),
      keys: sdkIx.keys.map((k) => ({
        pubkey: new anchor.web3.PublicKey(k.pubkey.toBase58()),
        isSigner: !!k.isSigner,
        isWritable: !!k.isWritable,
      })),
      data: Buffer.from(sdkIx.data),
    })

    // ── verify what we are about to ask the protocol to trust ───────────────
    const decoded = decodeEd25519(ix)
    assert.strictEqual(decoded.message.length, 81, 'receipt message must be the 81-byte layout')
    assert.ok(decoded.message.subarray(32, 64).equals(feedHashBuf), 'signed message carries a different feed hash')
    for (const t of decoded.triples) {
      const ok = nacl.sign.detached.verify(
        new Uint8Array(t.message),
        new Uint8Array(t.signature),
        new Uint8Array(t.pubkey),
      )
      assert.ok(ok, `ed25519 signature does not verify for ${new anchor.web3.PublicKey(t.pubkey).toBase58()}`)
    }
    const distinct = [...new Map(decoded.triples.map((t) => [t.pubkey.toString('hex'), t])).values()]
    console.log(
      `receipt: slot ${receipt.slot}, ${decoded.n} signature(s), ${distinct.length} distinct ` +
        `(${(receipt.failed_oracle_responses || []).length} failed) — attempt ${attempt}`,
    )
    if (distinct.length >= 3) {
      ed25519Ix = ix
      message = decoded.message
      n = decoded.n
      distinctSigners = distinct
    }
  }
  assert.ok(ed25519Ix, 'no receipt with 3 distinct signers after 6 gateway attempts')

  // Each signer must also be the oracle's CURRENT on-chain enclave key —
  // the receipt is only as honest as the enclaves the cluster recorded.
  const responseSignerHex = new Set()
  for (const r of receipt.oracle_responses) {
    if (r.ed25519_enclave_signer) responseSignerHex.add(r.ed25519_enclave_signer.slice(0, 64))
  }
  for (const t of distinctSigners) {
    const hex = t.pubkey.toString('hex')
    assert.ok(responseSignerHex.has(hex), 'signer did not come from this receipt')
    const oracleHex = receipt.oracle_responses.find(
      (r) => (r.ed25519_enclave_signer || '').slice(0, 64) === hex,
    ).oracle_pubkey
    const oraclePk = new anchor.web3.PublicKey(Buffer.from(oracleHex, 'hex'))
    const onchain = await sb.Oracle.loadData(sbProgram, oraclePk)
    assert.strictEqual(
      onchain.enclave.enclaveSigner.toBase58(),
      new anchor.web3.PublicKey(t.pubkey).toBase58(),
      'signer is not the oracle on-chain enclave signer',
    )
  }
  console.log(`${n} signatures verified; ${distinctSigners.length} distinct pinned-able enclave signers`)

  // i128 LE, decoded exactly as the program does: i128::from_le_bytes(msg[64..80]).
  let value = 0n
  for (let i = 0; i < 16; i++) value |= BigInt(message[64 + i]) << (8n * BigInt(i))
  value = BigInt.asIntN(128, value)
  assert.ok(value >= 0n, 'receipt value is negative')
  assert.strictEqual(value % UNIT, 0n, 'receipt value is not a whole 0.1 mm')
  const expectedMm10 = value / UNIT
  console.log(`signed value: ${value} → ${Number(expectedMm10) / 10} mm`)

  // ── 3. pin the trust root (admin, idempotent) ─────────────────────────────
  const pinned = distinctSigners.map((t) => new anchor.web3.PublicKey(t.pubkey))
  console.log('registering the feed binding (admin)…')
  await program.methods
    .registerSwitchboardFeed(new anchor.BN(SEASON), quoteAccount, Array.from(feedHashBuf), pinned)
    .accounts({
      authority: adminSigner.publicKey,
      config: configPda,
      farm: farmPda,
      oracleSet: oracleSetPda,
      binding: bindingPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([adminSigner])
    .rpc()

  // ── 4. relay the receipt permissionlessly (bootstrap just pays fees) ──────
  const submitIx = await program.methods
    .submitSwitchboardReading(new anchor.BN(SEASON), quoteAccount)
    .accounts({
      relayer: bootstrap.publicKey,
      oracleSet: oracleSetPda,
      farm: farmPda,
      binding: bindingPda,
      oracle: tallyPda,
      instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .instruction()
  const tx = new anchor.web3.Transaction().add(ed25519Ix).add(submitIx)
  const sig = await provider.sendAndConfirm(tx, [])
  console.log(`relay tx: ${sig}`)

  // ── 5. read it back ───────────────────────────────────────────────────────
  const tally = await program.account.weatherOracle.fetch(tallyPda)
  const reading = tally.readings.find((r) => r.oracle.equals(quoteAccount))
  assert.ok(reading, 'no reading landed under the feed seat')
  assert.strictEqual(
    BigInt(reading.totalRainfallMm),
    expectedMm10,
    `tally ${reading.totalRainfallMm} ≠ receipt ${expectedMm10} (0.1 mm)`,
  )
  console.log(
    `PASS: ${Number(reading.totalRainfallMm) / 10} mm relayed under ${quoteAccount.toBase58()} ` +
      `(season ${SEASON}, ${tally.readings.length} reading(s), finalized=${tally.finalized})`,
  )
}

main().catch((e) => {
  console.error('FAILED:', e && e.stack ? e.stack : e)
  process.exit(1)
})
