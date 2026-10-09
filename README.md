# indorse

A Solana mobile dApp for decentralised farm scouting, built with
[Expo](https://expo.dev) and the
[Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview)
via [`@wallet-ui/react-native-kit`](https://www.npmjs.com/package/@wallet-ui/react-native-kit).

Mobile Wallet Adapter is **Android-only**, so connecting a wallet requires an
Android device or emulator with a wallet app (e.g. Phantom, Solflare) installed.

---

## Project status

Snapshot as of **2026-10-07** — all four quality gates green
(`tsc --noEmit`, `prettier --check .`, `expo lint`, `vitest run`):
**762 tests passing · 1 skipped (the opt-in smoke test) across 87 files**
(`prettier --check .` is fully clean — `api/admin.test.ts` included).

| Area                | State   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| On-chain program    | Shipped | 28 instructions — authority is data (the config PDA `839zrf…YzaY8` on devnet holds the admin/verifier/oracle roles every ops gate reads, rotated by `set_roles` instead of a redeploy), verification is a bonded K-of-N quorum (the verifier-set PDA `H4HnKfqu…XK` holds k, the seat price, and members with their recorded stakes; `cast_vote` finalizes a report at quorum; `reconfigure_verifier_set` rewrites the rules, voluntary exits stop at the k-member floor, and `release_verifier` is governance's fair-exit valve), season readings are a median (the oracle-set PDA `12FrAm…zTf` holds an odd k and its unbound readers; the k-th reading freezes the median and `settle_policy` trusts only a finalized one), and custody is program-owned (settle/revoke sweep refunds to the treasury PDA's USDC ATA; `withdraw_treasury` releases them to the admin only); deployed to devnet (`GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht`), IDL synced via `npm run idl:sync`; 47 Anchor integration cases plus an opt-in RPC smoke test, the full Phase 1/3A lifecycle (realloc on an old-layout account, quorum floor, governed reconfigure, freeze-on-contact, release valve, recorded-stake refunds) rehearsed end to end against the live devnet state, and (Phase 3B) a live Switchboard On-Demand receipt — 3 enclave signatures proved off-chain and on-chain — relayed permissionlessly into the season tally on devnet (`5cfMd1pv…RUS8`); the multi-farm roster (per-farm seeds + `FarmCounter`, each farm keeps its own scout records) and the contract-review hardening (`close_settled_policy`, honest underfunded-settle errors, signer/tally bounds) were Anchor-tested at 47/47 on 2026-10-05 and **redeployed to devnet on 2026-10-07** (slot 508,420,779, the `.so` dump byte-compared against the build, live smoke round-trip green) — the same redeploy carried the coverage-funding step: `create_policy` now refuses a policy the treasury cannot fund (`TreasuryInsufficient`) and funds the vault in the same instruction, with `scripts/policy-solvency.ts` auditing every active vault |
| Scout tab           | Shipped | Chain-fed log and field cards, attention banner, folding action stack, camera → AI diagnosis, the 3-step onboarding card for the no-farm state (scan works before setup — anchoring needs a farm), and a persisted scan store: captures survive restarts (`indorse.scout.v1`) — with their evidence photos copied into app storage at submit — and anchor through an outbox flush once a farm is reachable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Provenance & escrow | Shipped | Score, evidence trail, harvest batches; escrow create → release / cancel-and-retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Weather             | Shipped | Policy setup, median-frozen oracle readings with error + retry, season chart plotted against the trigger — nothing reads as measured before the quorum finalizes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Profile & settings  | Shipped | Seven settings destinations (incl. Account & Local Data), passcode/biometrics app lock, hide balances, cluster health check, en/es/fr, system/dark/light themes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Data honesty        | Shipped | No mock data reaches the UI — empty states and honest guest/failure/loading notes instead; seed constants survive only as test/CSV fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CSV export          | Shipped | Live chain reads → one flat RFC 4180 file → share or copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AI proxy (`api/`)   | Shipped | Four routes, three jobs — photo diagnosis one route/two backends (OpenAI streamed `json_schema`, Gemini `responseSchema`; provider keys never reach the device), dual-model harvest grading (Gemini + Groq disagree → human-verifier flag), and the grounded "Ask indorse" assistant (Groq over a hand-written knowledge doc, explain-only, per-IP rate-limited)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Device verification | Shipped | SIWS nonce/verify routes, SGT dev allowlist, transactional email via Resend, and the Solana Attestation Service issuer (`api/_lib/sas-issuer.ts`, credential + schema created by `npm run sas:bootstrap`) — a successful OTP writes an on-chain attestation that the wallet controls the email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Launch media        | Shipped | Launch video in `brag-output-2026-09-30-183600/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**In flight:** the HyperFrames launch deck (`deck/`).

**Known gaps:** iOS scaffolding exists, but Mobile Wallet Adapter is
Android-only, so wallet connect is Android-only; persisted captures anchor
only to the farm that is current when the outbox flushes; evidence photos
are now copied into app storage at submit (`evidence/<sha256-of-bytes>.jpg`,
content-addressed, released when a row is evicted or erased, wiped with the
log in Account & Local Data), but there is still no upload backend — the
on-chain `uri` remains a deterministic placeholder, and public verification
from the chain alone (a hosted `uri`) is deferred; the React Query cache stays in-memory, so chain rows do not
survive an app restart without RPC — persisting the query client for offline
rows is deferred; on devnet the three roles are split across
deterministic per-role keys (`scripts/role-keys.cjs` — reproducible from a
public formula, so structural rather than secret), while the real Squads
M-of-N handover remains outstanding: creating the vault and signing the
rotation to it; Phase 1 verification ships bonds with a _governed_ slash only
(no automatic slash economics until real verifier behaviour exists to design
against), a set bounded at 7 members — since Phase 3A `k`/bond are
reconfigurable (`reconfigure_verifier_set`), but a split tally where every
member has already voted cannot finish after `k` is lowered, so finish open
tallies first; voluntary exits stop at the `k`-member floor, with
`release_verifier`/`slash_verifier` as governance's unconditional valves, and
the oracle-set equivalents of both are deferred until the Switchboard
question settles (compatibility is checked: `switchboard-on-demand` 0.13
compiles against anchor-lang 0.32 on a single solana 2.x stack, while classic
`switchboard-solana` 0.30 does not — it drags in anchor 0.30 +
solana-program 1.18; Phase 3B settled role 1 anyway by needing none of it —
the receipt path is native ed25519 precompile + address-pinned sysvar bytes
only, while queue/oracle-account validation (role 2) stays deferred), the now vestigial `config.verifier` field (it gates nothing since Phase 1 and is kept
only so the account layout doesn't migrate), and a protocol-fixed
`REPORT_REWARD`; Phase 2 readings defend by median alone — the readers carry
no bond (one liar cannot move the middle of three), their seats are
admin-assigned from deterministic devnet keys, seats default to exactly the
quorum so there is no liveness margin if a reader disappears (add spare
`add_oracle` seats for that), a reader's own pre-quorum correction replaces
rather than appends (once frozen the tally never moves), and `config.oracle`
is vestigial for the same layout reason as `config.verifier`; the final
device screenshots for the write-up are still outstanding; the
on-chain design edge — coverage funding with no solvency check — was
closed on 2026-10-07 (`create_policy` funds the coverage itself and
refuses a policy the treasury cannot carry; the pre-upgrade book is
audited by `scripts/policy-solvency.ts` — see _Future work_ below)
(the admin gate on `settle_policy`
has since been removed: settlement is permissionless, its authority the
frozen median plus the pinned payout destinations — same shape as
`reward_report`).

---

## Future work

Recorded 2026-10-05 so none of this lives only in someone's head; item 2
shipped 2026-10-07.

### Investor-funded vault model — marked for implementation

All underwriting capital is protocol-owned today: the program treasury PDA
is seeded by plain out-of-band USDC transfers (each new policy's coverage
is now CPI-drawn from it inside `create_policy`), and there is deliberately
no path for outside capital — no deposit instruction, no LP shares (the
Phase 1 boundary). The planned replacement, sketched against the current
program:

1. a `deposit_treasury`-style instruction with share accounting, so third
   parties can fund capacity and earn premiums;
2. **shipped 2026-10-07** — the on-chain coverage-funding step inside
   `create_policy`: the treasury balance is required (`TreasuryInsufficient`)
   before anything moves and the coverage lands in the vault in the same
   instruction, so a policy is provably funded the moment it exists;
3. solvency/allocation rules at `settle_policy` (per-policy allocation, not
   "whose vault happened to be topped up") plus a withdrawal queue for
   unencumbered capital.

### No solvency check before payout — closed at creation 2026-10-07; the legacy book still names the gap

Historically `settle_policy` paid out of the policy's own vault without
ever having checked that the coverage top-up happened. Funding was an
out-of-band plain transfer ("no instruction needed: anyone can credit the
vault"), so a forgotten top-up made settlement fail at the CPI with an
opaque token-program error — a fully valid, breach-triggering policy whose
payout simply did not land.

**What shipped (2026-10-07, devnet slot 508,420,779):** `create_policy`
requires `treasury_usdc.amount >= coverage_usdc` (`TreasuryInsufficient`,
error 6053) before any state or token movement and CPIs the coverage from
the treasury PDA in the same instruction — one farmer signature, no manual
top-up, and a doomed policy can no longer be created. `settle_policy`'s
honest `CoverageUnfunded` guard stays as defense for accounts predating
the upgrade. Deployed byte-for-byte from the local build (dump compared)
and smoke-tested live (register → report → read-back).

**What still names the gap:** policies created before the upgrade. The
devnet book has one — `6RzevvAs2aNhXQ4ta5vQmAtzLeQbjwZaELQ84t449itL`,
coverage 400 USDC against 50 in its vault; it will refuse to settle until
topped up. Audit the whole book instead of memory:

```bash
npx tsx scripts/policy-solvency.ts                 # default: devnet
SMOKE_RPC=http://127.0.0.1:8899 npx tsx scripts/policy-solvency.ts

# exit 0 = every active vault covers its policy
# exit 1 = at least one SHORT or missing vault (printed per policy)
# exit 2 = cluster unreachable — never a silent pass
```

The manual `spl-token display <vault-pda>` one-liner (balance ≥
`coverage_usdc`) still works for a single vault between runs.

---

## Getting started

```bash
npm install
npm run android
```

---

## User guide

**What it is.** indorse is a Solana app for smallholder farmers. You
photograph a crop to diagnose it, keep a farm record on the chain, and buy
parametric weather cover that pays on rainfall, not on damage.

**The four tabs** are **Scout**, **Provenance**, **Weather** and **Profile**.
A floating robot head sits bottom-left over every tab — that is **Ask
indorse**, the in-app guide. It explains how things work and never moves
money; how it answers is documented under
[Ask indorse](#ask-indorse--a-grounded-assistant-not-an-oracle).

### Wallet connect and sign-in

**What it does.** A wallet lets the app ask _you_ to sign each action —
registering a farm, logging a harvest, underwriting cover. Your keys stay in
your wallet app; indorse never holds them.

**Where.** Setup step **Connect your wallet**, the **Connect wallet** card on
the Scout tab, the wallet card on **Profile**, or **Settings → Wallet &
Security**.

**Steps.** Tap **Connect Wallet**, pick your wallet, approve the connection in
the wallet's own window. **Disconnect** is on the same button; **Log out** on
Profile disconnects and re-arms your passcode. Mobile Wallet Adapter is
Android-only, so this needs an Android device or emulator with a wallet app
installed.

**Device verification (Sign in with Solana).** With a wallet connected,
**Settings → Wallet & Security → Device verification** asks you to sign a
message and the server checks that signature against its device list. Tap
**Verify this device** and approve; the row reads **✓ Device verified** or
**Not on the allowlist yet**.

**The Seeker / SGT check.** This runs on the server, not on your screen. The
wallet is checked against the device allowlist first; if it isn't listed, the
server checks whether it holds a **Seeker Genesis Token** — the on-chain proof
that you own a Seeker phone. There is no separate "SGT" screen: the result
simply appears as the verification outcome, and it isn't stored or used to
gate anything else in the app. What a Seeker device _does_ show you is a
**Seed Vault secured** chip in the camera, the **Seeker Midnight** theme, and
a higher cover ceiling.

**Cover ceilings.** Cover is capped per device: **$100** at the base tier,
**$250** for verified operators, **$500** on a Seeker. Your tier isn't
displayed on any screen — you only meet the limit if you try to underwrite
above it, and the form tells you the exact figure.

### Email verification

**What it does.** Confirms an email bound to your wallet so you can recover a
forgotten passcode. It is _not_ used for notifications.

**Where.** **Settings → Wallet & Security**, with a wallet connected.

**Steps.** **Verify email** → enter the address → **Send a new code** → type
the 6-digit code → **Email verified**. Codes last 10 minutes and allow 5
attempts. You're also offered a recovery email when creating a passcode
(**Skip for now** is available); after a lockout, **Forgot passcode? →
Recover with email** sends a code there.

### Farms

**What it does.** Registers your farm on the chain and gives you a Provenance
record.

**Where.** Setup step 3, or the register card on the Scout tab.

**Steps.** Enter **Farm name**, **Latitude** and **Longitude** (or tap **Use
my location**), optionally **Acres** → **Create farm**. There's no crop field
at registration — crops come from your scout reports. Without a connected
wallet the farm is saved to the device only. Several farms are allowed: open
**Your farms** and tap **Add farm**.

The **Provenance** tab shows your **provenance score** (verified scouting
reports over the total), the escrow card, your on-chain addresses with
**Copy**, and **Delete farm**.

### Scouting and scout reports

**What it does.** Diagnoses a plant from up to **5 photos** — disease, pest or
stress — with severity, a confidence percentage, plain notes, and the plant's
common and botanical name plus the causal agent's scientific name when it can
be identified.

**Where.** The **Scout** tab.

**Steps.** Open the camera, take shots (the counter reads _n / 5_) →
**Analyze crop** → read the result → **Submit to Chain** to record it.
**Retake** discards, **Retry analysis** re-runs, and **View scouting log**
jumps to the list.

**Where reports live.** The **Scouting Log** section on the Scout tab — not
the Weather tab. Each row shows the date, diagnosis, field and crop, GPS,
image count, and a status: **Pending**, **Verified**, **Rejected** or
**Rewarded**. Verification is done by a bonded verifier set on the chain;
there's no in-app button to verify or reject a report.

### Harvest and escrow

**Logging a batch.** On Provenance, **Log a harvest batch** → **Crop**,
**Quantity (kg)**, coordinates (or **Use my location**), optional **Notes** →
**Log batch**.

**The AI grade.** Two independent models grade the batch A–D. You see the
grade and confidence in the logging preview, and whether the models agreed; if
they disagree the batch is flagged for a human verifier. If grading is
unavailable the button reads **Submit without a grade** — the batch is
honestly ungraded, not average. The grade is shown at logging time only.

**Escrow.** **Set up escrow** → **Amount (USDC)** and **Lock (days)** →
**Fund escrow**. On Provenance, **Release funds** is the farmer's action once
funded, **Cancel & refund** is the buyer's before the lock expires, and
otherwise _No conditions attached — funds release on delivery_.

### Weather cover (parametric insurance)

**What it does.** A parametric policy pays out in USDC when total season
rainfall falls **below** your trigger — a drought line. It's a fixed rule,
not an assessment: at or above the trigger the policy expires unpaid.

**Where.** The **Weather** tab (marked **β**).

**Steps.** **Underwrite policy** → **Crop**, **Coverage (USDC)**, **Premium
(USDC)**, **Rainfall trigger (mm)**, **Season start**, **Season end** →
**Underwrite policy**. The form enforces: premium at least 1% of coverage and
not above it, trigger no more than 1500 mm, season end after start, start
today or later, and at least 60 days between seasons.

**Reading the screen.** The policy card shows **Max Payout** and **Premium**,
an **Active** or **Expired** chip, and _Payout triggers if season rainfall
falls below N mm_. **Live Oracle Readings** compares season rainfall against
the trigger, and the verdict reads **Payout condition met — N mm below
trigger** or **No payout — N mm above trigger**, plus **Days Left**. Rainfall
comes from an on-chain oracle — there are no forecasts or weather feeds — and
a reading shows as **—** until enough readers agree and the median is frozen.

**Revoke policy** is available while active and before the season ends; the
premium returns to you. After the season, settlement and closing happen from
the admin console, not this screen.

### Rewards

**What it does.** Once a scout report is **Verified**, its reward can be
claimed.

**Where.** Expand a report row on the **Scout** tab — **Claim SKR reward**
appears only on a verified report.

**Steps.** Tap it and approve the transaction. If it's already been taken you
see _That reward has already been claimed_; if it isn't verified yet, _That
report is not verified yet_. The amount is fixed by the program — the same for
every report, farm and wallet — and always goes to the report's own reporter.
There are no bounties, staking or loans.

### Discover (farm directory)

**What it does.** Shows other farms near you, ranked nearest first, excluding
your own.

**Where.** The **Discover** section on the **Scout** tab, available whether or
not you have a farm.

**Each row** shows the farm name, a score chip, distance, verified-of-total
reports (or _No reports yet_), and how many await verification. Tap one for
**Distance**, **Coordinates**, **Reports**, **Verified**, **Awaiting
verification** and **Last report**, then **Scout this farm** to target it —
the camera shows _Scouting \[name\]_ and **Back to my farm** returns to your
own. If the directory is empty or unreachable the section says so rather than
showing stale data.

### Admin console

**What it does.** On-chain administration, for the wallet stored as the app's
admin — the check is the program itself, not just a hidden menu.

**Where.** **Profile → Settings → Admin Console**, shown only for that wallet.
Anyone else gets a read-only screen saying so.

**Sections.** **Identity**; **Roles** (rotate admin, verifier, oracle);
**Treasury** (balance and **Withdraw**); **Settlement** (**Settle policy**,
**Close settled policy**, once the season has ended and the oracle is
finalised); **Oracle seats** (add readers, submit readings, see the tally);
**Verifier seats** (add, release, slash, reconfigure); and **API admin**
(**Refresh API status**, plus the dev and operator allowlists). Every
destructive action asks you to type its instruction name first, and each admin
call is signed fresh from your wallet — no session is kept on the device.

Screen-by-screen developer detail for the rest of the settings is under
[Settings](#settings).

### First run

A three-slide intro leads to a welcome screen where **Enter App** is gated
behind a checkbox agreeing to the [Terms of Use](/legal?tab=terms) and
[Privacy Policy](/legal?tab=privacy); both names inside the sentence open
their tab. Onboarding only ever shows to first-time users, so that tick is
the one and only time consent is asked for.

Beyond the slides sits a six-step wizard — **Your profile**,
**Connect your wallet**, your farm, **Camera & location**, **Protect the app**
(the passcode), and **You're all set**. Every step has **Skip for now** and
**Back**, and the last button reads **Start scouting**. Anything skipped can
be finished later from the **Complete your setup** banner on the Profile tab.

---

## Build process

### Quality gates

Every change lands only with all four gates green, run in this order:

| Gate   | Command                  | What it catches                                                                   |
| ------ | ------------------------ | --------------------------------------------------------------------------------- |
| Types  | `npx tsc --noEmit`       | missing i18n keys (es/fr are typed `Record<MessageKey, string>`), hook/type drift |
| Format | `npx prettier --check .` | the whole tree — app, tests, `api/`, even `deck/` HTML and Markdown               |
| Lint   | `npx expo lint`          | React hooks rules, dead code                                                      |
| Tests  | `npx vitest run`         | behaviour — 92 files, 832 passing + 1 skipped (the opt-in smoke test)             |

`npm run ci` chains the same checks and finishes with an Android prebuild, so
it also catches anything Metro refuses to bundle.

### Test strategy — stub at the layer you are testing

Tests live at the repo root or beside the code, **never under `app/`** (see
_Failures_ below — Metro would bundle them into the release JS). Each suite
stubs the layer its subject actually talks to:

| Layer                  | Suites                                        | Stub                                                                                    |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hook boundary          | `screens`, `settings`, weather/profile suites | `vi.mock` of `useFarmQuery`, `useMobileWalletSetup`, … driven by scenario objects       |
| JSON-RPC boundary      | `scout-chain.test.tsx`                        | a global `fetch` answering `getAccountInfo` / `getMultipleAccounts` — real codec + PDAs |
| Native module boundary | camera, auth, settings                        | `expo-haptics`, `expo-camera`, location and clipboard stand-ins                         |
| Network (opt-in)       | `test/smoke.test.ts`                          | a real RPC behind `SMOKE_RPC=…` — never runs in the offline gate                        |

Two rules the suite enforces, both learned from failures:

- **Reset scenario state in a file-level `beforeEach`** — vitest runs without
  `clearMocks`, so a scenario left populated poisons every later test in the
  file (this bit the Profile tests after the export suite).
- **Await every `fireEvent` call** — RNTL v14 flushes state per call; an
  un-awaited press races the re-render it is supposed to observe.

### Device dev loop

```bash
npm run api:dev                 # AI proxy + SIWS on :3000
npx expo start --dev-client --port 8081
adb reverse tcp:8081 tcp:8081   # Metro   → device
adb reverse tcp:3000 tcp:3000   # API     → device
adb install -r <debug.apk>      # first run, or after Android wipes app data
```

`npm run up` (`scripts/dev-up.sh`) runs those four lines in order as one
command: preflight (`node_modules`, `.env`, an attached adb device, free
ports) → `api:dev` → Metro → both `adb reverse` lines → the
`POST /api/siws/nonce → 200` check below. It reuses whatever is already
healthy rather than starting a second copy, stops only what it started, and
puts back any `adb reverse` line it changed. `npm run up -- --check` gates
startup on the four quality gates; `--keep-cache` skips the Metro cache
clear. It supervises processes; `dev:tunnel` below is what self-heals them.

Background shells do not survive an environment restart, and when they die the
symptoms look exactly like an app failure. After any restart, re-run the lines
above and verify `POST /api/siws/nonce → 200` **before** debugging deeper.

`npm run dev:tunnel` (`scripts/tunnel-watchdog.sh`) supervises that loop
instead of leaving it to be re-typed: every few seconds it health-checks the
API, scans for whichever Metro port answers, re-adds any missing
`adb reverse` line, and self-heals — restarting the preferred Metro after
three dead cycles, and `api:dev` only when the API is dead _and_ no
supervisor is already about to restart it. It prints state **changes** only,
so the log stays quiet while healthy (`TUNNEL_WATCH_INTERVAL` tunes the
cadence).

### On-chain change loop

`anchor build` → `npm run idl:sync` → `npm run client:generate` → deploy (devnet,
or `solana program-v4` on a local validator — see _Running Anchor tests_) →
optional live round-trip with `SMOKE_RPC=… npx vitest run test/smoke.test.ts`.

### Release builds (EAS)

`eas.json` defines three Android profiles (the file is validated against
`@expo/eas-json`, which rejects unknown keys and out-of-range values):

| Profile       | Output               | Distribution | Use                   |
| ------------- | -------------------- | ------------ | --------------------- |
| `development` | APK + dev client     | internal     | sideloaded dev builds |
| `preview`     | APK                  | internal     | tester shares         |
| `production`  | AAB, `autoIncrement` | store        | Play submission       |

```bash
npx eas-cli login
npx eas-cli init               # writes extra.eas.projectId into app.json
npx eas-cli build -p android --profile preview
npx eas-cli build -p android --profile production
npx eas-cli submit -p android --profile production   # needs google-service-account.json
```

**Build-time env.** `EXPO_PUBLIC_*` is inlined by Metro at bundle time, so it
has to exist _in the build environment_ — `.env` is gitignored and EAS never
sees it. A build without them still compiles, installs and runs: `getApiOrigin()`
returns `null` and the AI / assistant / funds-tier features disable themselves
rather than guess an origin. Supply what you need via the profile's `env` block
or EAS environment variables:

- `EXPO_PUBLIC_AI_CLASSIFY_URL` — the one URL everything else derives its origin from
- `EXPO_PUBLIC_AI_GRADE_URL`, `EXPO_PUBLIC_AI_ASSISTANT_URL`
- `EXPO_PUBLIC_FUND_TIER_URL` (unset = the tier gate is off, by design)
- `EXPO_PUBLIC_API_FALLBACKS` (optional — the liveness-probe candidate list)

`EXPO_PUBLIC_FORCE_SEEKER` is pinned to `"false"` in all three profiles: it is a
dev flag that must never ship enabled. A build whose environment has no
`EXPO_PUBLIC_AI_CLASSIFY_URL` ships with the AI / SIWS features off
(`getApiOrigin()` returns `null`), so point a release build at a deployed API
origin first — see _Deploying the API_ below.

The submit profile points at `./google-service-account.json`, which is
gitignored like every other key.

### Deploying the API (Vercel)

The `api/` handlers are Vercel-function compatible, and **only `api/` deploys** —
the Expo app is built with EAS, never here.

- `vercel.json` pins `"framework": null` and `"buildCommand": null` so Vercel
  does not run this repo's `build` script (an Android prebuild), sets
  `"outputDirectory": "public"`, and raises the function budget to 60s for the
  vision routes (lower it if your plan rejects 60).
- `public/index.html` is a placeholder — without an output directory Vercel
  fails with _"No Output Directory named public"_.
- `.vercelignore` drops `api/**/*.test.ts`: Vercel turns every non-underscore
  file under `api/` into a function, and the colocated vitest files import
  vitest, which the function bundler cannot resolve.
- `installCommand` passes `--legacy-peer-deps` because the root `package.json`
  carries the React Native tree; drop the flag if the install passes without it.
- The `@/*` path alias resolves from `tsconfig.json`, which Vercel's Node
  builder honours — the handlers keep importing `@/features/…`.

```bash
npx vercel link
# Set for PRODUCTION — Preview-only vars are the classic "works in preview,
# 500s in prod" trap. Server-only; never EXPO_PUBLIC_:
npx vercel env add GEMINI_API_KEY production
npx vercel env add OPENAI_API_KEY production
npx vercel env add GROQ_API_KEY production        # rotate first — see the AI env note
npx vercel env add RESEND_API_KEY production
npx vercel env add SGT_RPC_URL production          # enables the real SGT gate
npx vercel env add SGT_DEV_ALLOWLIST production    # clear the '*' before judging
npx vercel env add OPERATOR_ALLOWLIST production
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
npx vercel env add SIWS_DOMAIN production          # must match what the app signs in with
npx vercel env add SIWS_URI production
# SAS_* only if you are writing attestations.
npx vercel deploy --prod
```

Then, before touching anything else:

```bash
curl -X POST https://<deployment>.vercel.app/api/siws/nonce   # expect 200
```

#### Serverless state — the nonce store must be shared

Serverless instances do not share memory. What is and is not safe here:

- **SIWS nonces** — shared _only when `UPSTASH_REDIS_REST_URL` **and**
  `UPSTASH_REDIS_REST_TOKEN` are set_; the store then reads-and-burns through
  Redis `GETDEL`. With neither set it falls back to a per-process `Map`, and
  `/api/siws/nonce` → `/api/siws/verify` can land on different instances and
  answer `401`. **Set both, or sign-in fails intermittently.**
- **Email OTP codes** (`api/_lib/otp-store.ts`) — still a per-process `Map`:
  `/api/email/start` and `/api/email/verify` can miss each other the same way.
- **Per-IP rate limits** (`api/assistant.ts`, `api/directory.ts`) — per-process
  counters, so the effective cap is `max × instances` rather than 30/min.
  Degraded, not broken.
- **Admin-console allowlist overrides** (`api/_lib/allowlist.ts`) — per-process;
  an edit applies only to the instance that served it. The `env` base is what
  every instance agrees on.

#### Two things that will bite judges

- **Resend's sandbox sender only delivers to your own inbox** — email
  verification fails for anyone else until a sending domain is verified.
- **The SGT gate fails closed** — a judge with no Seeker cannot sign in unless
  they are on `SGT_DEV_ALLOWLIST`. Decide that deliberately.

#### Point the app at it, then build

Put the deployed origin in the **app's build environment** (EAS profile `env` or
EAS environment variables), not in Vercel's:

```bash
EXPO_PUBLIC_AI_CLASSIFY_URL=https://<deployment>.vercel.app/api/classify-gemini
EXPO_PUBLIC_AI_GRADE_URL=https://<deployment>.vercel.app/api/grade
EXPO_PUBLIC_AI_ASSISTANT_URL=https://<deployment>.vercel.app/api/assistant
EXPO_PUBLIC_FUND_TIER_URL=https://<deployment>.vercel.app/api/funds-tier
```

`EXPO_PUBLIC_*` is inlined at bundle time, so the sequence is **deploy the API,
set these, then `eas build`** — a build made before the URLs exist ships with the
AI / SIWS features off. The app derives its SIWS origin from
`EXPO_PUBLIC_AI_CLASSIFY_URL`, so `/api/siws/*` is reachable the moment that one
URL is set. Leave `EXPO_PUBLIC_FORCE_SEEKER` as `"false"`.

### Rules the codebase enforces

- **No invented data** — screens render chain values or an explicit empty /
  error / guest state. A value the chain does not store becomes an empty CSV
  cell, never a plausible-looking number.
- **i18n** — `lib/translations/en.ts` is the source of truth; `es.ts` and
  `fr.ts` are typed against it, so a new key fails `tsc` until translated.
- **Theming** — every screen builds styles with `makeStyles(colors)`, which
  makes light mode a palette swap instead of a second stylesheet.
- **Secrets stay server-side** — provider keys live only in the `api/`
  proxies; the app knows only public per-route URLs
  (`EXPO_PUBLIC_AI_CLASSIFY_URL`, `EXPO_PUBLIC_AI_GRADE_URL`,
  `EXPO_PUBLIC_AI_ASSISTANT_URL`).
- **The app lock is not a wallet** — the passcode protects the app in
  `expo-secure-store`; signing always goes through Mobile Wallet Adapter.

---

## Failures & fixes

A running postmortem: what broke, why, and the guard that now prevents it.

### Release-blocking

| Failure                                                                               | Root cause                                                                                                                                               | Fix / guard                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App died at startup with an opaque Metro transform error                              | A `*.test.*` file under `app/` entered Metro's module graph (its default `blockList` excludes nothing), bundling `describe`/`expect` into the release JS | Test moved to the repo root (`entry.test.tsx`); `test/bundle-guard.test.ts` now fails the suite if any test file appears under `app/` again                                                                           |
| "App not loading" on the device (2026-10-04)                                          | Two independent faults at once: the `adb reverse` mappings for 8081/3000 were gone **and** the APK was not installed (Android had wiped local app data)  | Restored both `adb reverse` lines, `adb install -r` the debug APK, verified the bundle answered HTTP 200 (~15 MB). The recovery checklist now lives in _Build process → Device dev loop_                              |
| Gemini proxy hung or failed silently in production                                    | Node's global `fetch` is HTTP/1.1-only, and the POC's mobile uplink blackholes H1 POSTs to Google's edge while H2 gets through                           | `h2Fetch` (`api/_lib/gemini.ts`) — a `node:http2` fetch-shaped client with a hard deadline that surfaces a mapped `timeout` instead of a hung proxy. **Never regress it**; tests inject `fetchImpl`                   |
| Plain `anchor test` could not run                                                     | Anchor 0.32 drives Surfpool, which does not start in this environment; separately, Agave ≥ 2.2 rejects _new_ loader-v3 deploys on a local validator      | Run against `solana-test-validator` and deploy with `solana program-v4` — documented in _Running Anchor tests_                                                                                                        |
| Devnet reads failed intermittently                                                    | Helius free-tier rate limiting                                                                                                                           | Fall back to the public `https://api.devnet.solana.com` endpoint                                                                                                                                                      |
| Devnet upgrade rejected: `ExtendProgram requires a minimum of 10240 additional bytes` | loader-v3 grows the programdata in ≥10,240-byte chunks; the new `.so` was only 2,176 B larger than the deployed one (2026-10-07)                         | `solana program extend <PROGRAM_ID> 10240 --url devnet` first, then re-run the deploy. If confirmation outlives the CLI the fully-uploaded buffer survives — reuse it with `--buffer <addr>` rather than re-uploading |

### Mock data shipped to the UI (purged)

| Failure                                                           | Root cause                                                                                                                                                | Fix                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The scout screen still showed placeholder rows after the redesign | `SCOUT_EVENTS` was wired as the _fallback_ for log and fields, the success banner claimed "All fields clear" with zero data, a seeded row stayed expanded | Log/fields fall back to `[]`, the banner only renders when `fields.length > 0`, the expanded row defaults to nothing — seeds kept as test/CSV fixtures                                                   |
| Notifications arrived pre-populated                               | A `NOTIFICATIONS` constant seeded the provider                                                                                                            | The provider starts `useState([])` and the constant is deleted; real items (AI diagnosis, escrow) arrive only through `add()`                                                                            |
| Settings → CSV export showed fake records                         | The export screen read static data instead of the chain                                                                                                   | `lib/csv.ts` rebuilt around a pure `FarmRecordInput`; the screen wired to the live chain queries with banner states for chain error / loading / no wallet / no farm, and `canExport` gating both actions |

### Test-suite incidents

| Failure                                                                         | Root cause                                                                                                                                                                                                              | Fix / rule                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 export tests: "Connect a wallet to export" shown despite a populated scenario | The file-level `useMobileWalletSetup` mock hardcoded `address: null`, bypassing the kit-level scenario the suite drove                                                                                                  | The mock reads the shared `exportScenario.address`; `beforeEach` resets it so later suites still see a guest                                                        |
| Later tests poisoned by earlier ones                                            | No `clearMocks` in the vitest config — scenario objects leaked across tests (ProfileScreen mounted the export suite's mocks)                                                                                            | File-level `beforeEach` reset of every scenario + `vi.clearAllMocks()`                                                                                              |
| Fold-dock test: the modal never mounted after unfolding                         | Un-awaited `fireEvent.press` — RNTL v14 flushes per call, so the next press landed while the stack was still `pointerEvents: 'none'`                                                                                    | Await **every** `fireEvent` call                                                                                                                                    |
| Profile screen crashed after a camera-test mock changed                         | `vi.mock('@/features/scout/location')` returned only `getCurrentCoords`, but `useSetupSignals` also calls `getLocationPermission`                                                                                       | Mock a module's full export surface (or spread `importOriginal`) — a partial mock breaks every other consumer                                                       |
| CSV export button enabled for a wallet with nothing to export                   | The scenario set `rowCount > 0` while `address` was null                                                                                                                                                                | Scenario rule: `address` must be set whenever `farm` is set                                                                                                         |
| Phase 1 negative tests failed with "insufficient lamports" instead of the gate  | Anchor executes an instruction's `init` rent transfer **before** its account constraints, so a zero-lamport stranger paying for an `init`/`init_if_needed` died on the transfer instead of reaching `UnauthorisedAdmin` | `fund()` the transient signer first (rule documented at the helper); load failures also precede constraints, so account existence errors surface before gate errors |
| Phase 2 finalize assertion: "expected 1791161395 to be a number or a date"      | `reading_timestamp` is an i64, so the Anchor client hands back a BN — chai's `isAbove` only accepts number/Date comparands                                                                                              | Cast with `Number(...)` before numeric comparisons (BN stringifies to its decimal value)                                                                            |

### Program build incidents

| Failure                                                                                                                                                                                                           | Root cause                                                                                                                                                                                                                                                                                                             | Fix / rule                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor build`: `expected ':'` at `realloc payer = member`                                                                                                                                                        | Anchor 0.32's constraint parser takes the **path** form for realloc's sub-keys; the bare `realloc payer = …` spelling in older examples predates it                                                                                                                                                                    | Write `realloc::payer = <signer>` and `realloc::zero = false`                                                                                                                                                                                                                                                                |
| `anchor build`: `cannot find value 'target' in this scope` (in a constraint)                                                                                                                                      | Instruction args are **not** in scope inside `#[account]` constraints — `ManageOracle`'s `member` is an account field, not the `remove_oracle` argument                                                                                                                                                                | Validate arg-derived conditions in the handler with `require!` before any state moves — the refund-owner pin in `release_verifier` does exactly that                                                                                                                                                                         |
| Every relay: `AnchorError caused by account: slot_hashes … AccountSysvarMismatch (3015)` — "The given public key does not match the required sysvar" — while the transaction provably carried `SysvarS1otHashes…` | `Sysvar<'info, SlotHashes>` can never work: solana-sysvar 2.3+ **deliberately refuses** in-program deserialization of `SlotHashes` (`from_account_info` → `UnsupportedSysvar` — 20 KB is "too large to bincode::deserialize"), and anchor maps any such failure to `AccountSysvarMismatch` with a key-mismatch message | Pin the address instead: `#[account(address = SLOT_HASHES_SYSVAR)]` on an `UncheckedAccount`, read the raw bytes with bounded count/length checks first — the pattern the instructions sysvar already used. A wrong error message sent the investigation through the tx's account metas before the crate source explained it |

### Environment & process

- **Parallel sessions share one working tree.** Repo-wide gates fail on
  artifacts from another workstream (scratch `*.test.tsx` at the root,
  unformatted `deck/` files). Run all four gates right before any handoff, and
  never leave scratch files at the repo root.
- **A gitignored worktree is not excluded by default.** A parallel session's
  `.kilo/worktrees/…` copy put its stale tests in the run, and with `@/*`
  resolving to _this_ tree they failed against the wrong source (7 files, 30
  tests). `vitest.config.mts` now excludes `.kilo/**` explicitly — vitest
  does not read `.gitignore`, unlike prettier and eslint.
- **Environment restarts kill background shells.** Metro, the API server and
  `adb reverse` vanish together — see _Device dev loop_ for the recovery order.

---

## On-chain program

The Anchor program lives in `programs/indorse_program/` and exposes 28
instructions. Layer 0 is the config: the `Config` PDA (seeds `["config"]`)
holds the admin/verifier/oracle roles every ops gate reads, so authority is
swappable account data — the `ADMIN` const survives only as the one key
allowed to call `init_config`. Custody is program-owned too: insurance refunds
sweep into the `["treasury"]` PDA's USDC ATA, never a wallet's.

Verification (Phase 1) replaces the old single `config.verifier` key with a
bonded K-of-N verifier set: `init_verifier_set` fixes the quorum `k` (2–7) and
the USDC bond price, members seat themselves with `post_bond` (recording
exactly what they paid), and `cast_vote` finalizes a report the moment one
side reaches `k` — approve or reject, one vote per member. Bonds leave only
three ways: back to the member via `remove_verifier` (refused while the set
stands at `k` members) or a governed `release_verifier`, or to the treasury
via a governed `slash_verifier`.

Season readings (Phase 2) replace the old single `config.oracle` key with an
admin-managed oracle set: `init_oracle_set` fixes an **odd** quorum `k` (3–7 —
an even count has no unambiguous middle value, and `k=1` would recreate the
single-reader regime), `config.admin` seats unbound readers with `add_oracle`,
and each reader posts its own rainfall to the per-season `["weather", farm,
season]` tally — replacing its own entry while the tally is open, never
double-counting. The `k`-th reading sorts the tally, freezes the **median**
into `total_rainfall_mm`, stamps the time and closes the account: late
submissions bounce off `finalized`, and `settle_policy` refuses to pay out of
a partial tally. Readers carry no bond — a liar cannot move the middle of
three — and removed readers' readings persist.

Governed reconfiguration (Phase 3A) takes the frozen rules off the verifier
set: `reconfigure_verifier_set` rewrites `k` and the seat price under the same
bounds init ran under (`config.admin`, evented), and repricing affects future
joins only because each seat's entry records the exact stake it paid — exits
refund it, slashes take it, never the current price. A voluntary exit refuses
to drop the set below `k` (the `DropBelowQuorum` floor); governance bypasses
that floor on purpose: `release_verifier` frees a seat with its stake
returning to that member's own USDC account (the fair-exit valve), and
`slash_verifier` still forfeits to the treasury. `cast_vote`
freezes-on-contact — when a side already stands at `k` after a lowering, the
next vote finalizes the report without recording a ballot (the ops rule
remains: finish open tallies before lowering `k`, because a split tally where
every member already voted cannot progress). Sets allocated under the old
bare-pubkey layout are normalized by a realloc on the first `post_bond` —
the realloc path has been exercised live on devnet, against an account
allocated by the old program (see the lifecycle rehearsal below). The
oracle-set equivalents (reconfigure, floor) are deferred until the Switchboard
integration question settles.

Switchboard receipts (Phase 3B) give an external oracle network a voice in
that same tally without ever handing it a key. `register_switchboard_feed`
(`config.admin` only, and the feed must already hold an oracle-set seat via
`add_oracle`, so a receipt enters as an assigned reader — not a spare voice)
pins a `SwitchboardFeedBinding` PDA: farm, season, feed, the 32-byte job
hash, and at least three distinct enclave signers; re-running it is the
rotation path, and it revokes the old keys the moment it lands.
`submit_switchboard_reading` is then **permissionless**: the authority is the
receipt itself. The transaction carries Solana's ed25519 precompile proof,
which the runtime verifies before our code runs; the instruction re-reads the
proven signer/message pairs through the address-pinned instructions sysvar,
requires the bound job hash, `max(3, min_samples)` distinct pinned enclave
keys, a slothash still inside the 512-slot `SlotHashes` window, and an i128
value that divides exactly into whole 0.1 mm units (the job signs at 1e18;
divide by 1e17) — then writes it into the per-season tally under the feed's
seat through the same helper `submit_oracle_reading` uses. Median, freeze and
`settle_policy` are untouched; the relayer's only cost is rent for a tally
the season has not created yet.

| Instruction                  | Description                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_config`                | One-shot bootstrap: the hard-coded `ADMIN` creates the config PDA and sets the initial admin/verifier/oracle roles (all three default to that same key)                                                                                                                                                                                      |
| `set_roles`                  | Rotate all three roles in one atomic transaction, signed by the current `config.admin` — how authority moves to a multisig vault without a program upgrade                                                                                                                                                                                   |
| `register_farm`              | Create a farm PDA seeded by `[b"farm", owner]`                                                                                                                                                                                                                                                                                               |
| `delete_farm`                | Close the farm PDA and refund its rent (owner only) — child accounts (reports, batches, policies) stay on chain as an independent trail                                                                                                                                                                                                      |
| `submit_scout_report`        | Submit a field photo report for a farm                                                                                                                                                                                                                                                                                                       |
| `init_verifier_set`          | One-shot rules for verification: quorum `k` (2–7) and the USDC bond each member posts (`config.admin` only)                                                                                                                                                                                                                                  |
| `reconfigure_verifier_set`   | Rewrite the verifier set's `k` and seat price (`config.admin`, same bounds as init) — repricing applies to future joins only; existing seats keep their recorded stakes                                                                                                                                                                      |
| `post_bond`                  | Join the set: the member's own USDC account pays the bond into the program-owned bond vault (the set PDA's canonical ATA) and the seat records exactly what was paid (a pre-Phase-3A set reallocs to the current layout on this first join)                                                                                                  |
| `remove_verifier`            | Voluntary exit: the member leaves and their recorded stake returns to their account — refused while the set stands at `k` members or below (the quorum floor); votes already cast keep counting                                                                                                                                              |
| `release_verifier`           | Governed fair exit (`config.admin`): the seat is removed and its stake returns to that member's own USDC account — the unconditional valve that keeps the quorum floor from becoming a trap                                                                                                                                                  |
| `slash_verifier`             | Governed slash (`config.admin`): the member is removed and their recorded stake moves to the treasury — deliberately no automatic slashing rules; may leave the set below `k` (governance's other unconditional lever)                                                                                                                       |
| `cast_vote`                  | One quorum vote per bonded member on a pending report; the first side to reach `k` finalizes it (an approval bumps the farm's verified count), and the pending gate closes the tally against late votes                                                                                                                                      |
| `init_oracle_set`            | One-shot rules for season readings: an **odd** quorum `k` (3–7) that defines the median (`config.admin` only — no bond, by design)                                                                                                                                                                                                           |
| `add_oracle`                 | Seat a reader (`config.admin` assigns the seat — unlike verifiers, readers carry no bond, so the assignment cannot be bought or forged)                                                                                                                                                                                                      |
| `remove_oracle`              | Revoke a reader's seat (`config.admin`); readings they already posted stay in the tally — a removed reader cannot un-notice a season                                                                                                                                                                                                         |
| `reward_report`              | Pay SKR tokens to the reporter — permissionless since Phase 1: the Verified status is the whole gate, the destination is pinned to `report.reporter`, and `REPORT_REWARD` is protocol-fixed                                                                                                                                                  |
| `submit_harvest_batch`       | Record a harvest batch with provenance snapshot                                                                                                                                                                                                                                                                                              |
| `create_escrow`              | Buyer deposits USDC into escrow for a batch                                                                                                                                                                                                                                                                                                  |
| `release_escrow`             | Farmer claims the escrowed funds                                                                                                                                                                                                                                                                                                             |
| `cancel_escrow`              | Buyer cancels before lock — escrow + vault are closed, USDC and rent refunded, batch slot freed for retry                                                                                                                                                                                                                                    |
| `create_policy`              | Create a parametric weather-insurance policy (single farmer signature; the treasury tops up coverage with a plain token transfer)                                                                                                                                                                                                            |
| `submit_oracle_reading`      | Post (or, pre-quorum, replace your own) season rainfall in the per-season tally; the `k`-th reading freezes the median and stamps `finalized` — readers only, one entry each                                                                                                                                                                 |
| `register_switchboard_feed`  | Pin — or re-pin — the Switchboard job's trust root for one farm/season: feed, 32-byte job hash and ≥3 distinct enclave signers (`config.admin` only, feed must already hold an oracle-set seat; re-running is the queue's key-rotation path)                                                                                                 |
| `submit_switchboard_reading` | Relay a Switchboard On-Demand receipt **permissionlessly**: re-read the ed25519 precompile's verified signer/message pairs through the address-pinned instructions sysvar, require the bound job hash, the pinned-enclave quorum, 512-slot freshness and an exact whole-0.1 mm value, then record it under the feed's seat in the same tally |
| `settle_policy`              | Pay out or expire a policy after the season ends — **permissionless**: any signer may settle once the median is frozen and the season over (the caller influences nothing; destinations and amount are pinned) — no-trigger refunds are swept to the program treasury's USDC ATA (address-derived, mint-checked)                             |
| `revoke_policy`              | Farmer revokes an active policy before the season ends: the premium returns from the policy vault, the treasury's top-up sweeps into the program treasury's USDC ATA, both accounts close (rents to the farmer) — refused once the season is over, when `settle_policy` takes over                                                           |
| `withdraw_treasury`          | Move accumulated refunds out of the program treasury to the admin's own USDC account — the treasury PDA signs the transfer, `config.admin` gates it, and the destination must be the admin's account                                                                                                                                         |

**Program ID:** `GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht`

The IDL and TypeScript types are generated at:

- `programs/indorse_program/target/idl/indorse_program.json`
- `programs/indorse_program/target/types/indorse_program.ts`

The app consumes a copy at `lib/idl/indorse_program.json`; refresh it after any
program change with:

```bash
npm run idl:sync
```

A program change is a **coordinated cut-over**: the client and the program
must move together (account lists differ per version — e.g. `revoke_policy`
now takes the treasury PDA and no `config`, which an older program would
reject). Order of operations:

```bash
cd programs/indorse_program
anchor build                                 # compile + regenerate IDL/types
cd ../.. && npm run idl:sync && npm run client:generate
cd programs/indorse_program
solana program deploy --program-id target/deploy/indorse_program-keypair.json \
  target/deploy/indorse_program.so --url devnet    # in-place upgrade
# loader-v3 grows programdata in ≥10,240-byte chunks — on a small size
# delta, run first: solana program extend <PROGRAM_ID> 10240 --url devnet
node scripts/init-config.cjs                      # idempotent: config + treasury ATA + verifier set + bond vault + oracle set
```

`scripts/init-config.cjs` defaults to devnet, is safe to re-run (an existing
config prints its roles; the treasury and bond-vault USDC ATAs are
`getOrCreate`), takes `RPC_URL=http://127.0.0.1:8899` for a local validator,
and takes `USDC_MINT=…` where the mint isn't the app's devnet USDC. The
verifier-set step signs with whoever holds `config.admin` _now_ (derived key
after the role rotation, bootstrap before it) and takes `K` and `BOND_AMOUNT`
(atomic units) for the rules; membership itself is never scripted — each
verifier seats itself with `post_bond` from its own wallet. The oracle-set
step (Phase 2) takes `ORACLE_K` (odd, default 3) and — because readers carry
no bond — also seats the deterministic `oracle-1…n` keys from `role-keys.cjs`
and tops them up for fees and the tally's first rent, both idempotently.

### Multi-farm roster + contract-review hardening (2026-10-05)

`register_farm` used to pin one farm per wallet (seeds `["farm", owner]`).
The rework derives every farm at `["farm", owner, u32(index)]` and keeps a
per-owner `["farm_counter", owner]` PDA whose monotonic `count` is the next
free slot — never decremented, so deleted slots are not recycled. The
instruction takes the counter account alongside the derived index; the client
mirrors the whole roster: `FarmChainSync` enumerates `0…count-1` off the
counter and upserts each farm into the registry independent of the current
selection, `useFarmQuery` honors the registry's chain-current address
(falling back to slot 0 with a post-fetch ownership guard), and each farm
keeps its own scout log — reports, tallies and batches hang off the per-farm
PDA, so switching farms switches the records.

A line-by-line contract review (adversarial read of `lib.rs` against
anchor-syn 0.32.1's codegen and the live devnet accounts) landed:

- **`close_settled_policy` (new, permissionless)** — once a policy settled,
  nothing could move its premium or reclaim the policy/vault rents:
  `settle_policy` and `revoke_policy` both require `Active`. The new
  instruction mirrors `revoke_policy` exactly — an explicit terminal-state
  gate (`PaidOut` or `Expired`, never "anything but Active"), the vault
  remainder swept to the treasury's canonical USDC ATA, `token::close_account`
  returning the vault rent to the farmer, and Anchor `close = farmer` on the
  policy — with both destinations pinned so a caller chooses nothing.
- **Underfunded settles fail honestly** — `settle_policy` now refuses with
  `CoverageUnfunded` before the CPI instead of retrying an opaque token
  error; the policy stays `Active`, so `revoke_policy` remains the escape
  hatch until `season_end`.
- **Feed-signer bound** — `register_switchboard_feed` refuses more than
  `MAX_ORACLES` signers (`TooManyFeedSigners`) rather than failing inside
  account serialization.
- **Tally capacity** — `cast_vote` refuses a ballot past `MAX_VERIFIERS`
  (`TallyFull`), reachable only through mid-tally membership rotation, so
  the `reconfigure_verifier_set` docs now carry the full ops rule: finish
  open tallies before lowering `k` **or rotating members**.
- **Docs corrected** — the PostBond realloc invariant now states the
  empty-only rule where the realloc lives (anchor-syn deserializes before
  constraints run, so a non-empty old-layout set must be closed and
  re-inited, never realloc'd); `delete_farm` documents that a report still
  Pending at deletion can never be voted on; two orphaned doc comments that
  were corrupting the IDL (`init_verifier_set`/`init_oracle_set` carried
  another instruction's docs) were removed; and `cast_vote`'s farm
  constraint reports `FarmMismatch` instead of a raw constraint error.

Known and accepted: the legacy two-seed farm (the pre-rework "Blue Berry
Farms" account on devnet) can never be closed by `delete_farm` — its
≈0.0011 SOL rent stays stranded; re-registering under the new seeds is the
migration, and no legacy-close instruction is planned for devnet dust.

### Devnet role keys

Roles on devnet are split across three independent keys, derived
deterministically so they never need a backup:

```bash
cd programs/indorse_program
node scripts/role-keys.cjs           # print admin/verifier/oracle keys + oracle-set seats
node scripts/role-keys.cjs rotate    # set_roles to them (idempotent)
```

The formula is `sha256("indorse-devnet-role-v1:<role>") → Keypair.fromSeed` —
public by design, which means anyone can derive it and sign as these roles:
the devnet roles structure the flow (a separate key per gate, the rotation
path rehearsed end to end with both signers proven), they do not secure it.
`ROLE_SEED` overrides the seed, `ADMIN/VERIFIER/ORACLE` override individual
rotation targets (rotate back to the bootstrap key with all three), and
`RPC_URL` picks the cluster. The same derived admin key also signs Phase 1,
Phase 2 and Phase 3A state (reconfigurations are run ad hoc, never scripted):
`scripts/init-config.cjs` creates the devnet verifier set
(`H4HnKfqu…XK`, k=2, 5 USDC bond) and the devnet oracle set
(`12FrAm…zTf`, odd k=3, seats `oracle-1…3`) with it. A Squads vault holding
real keys is still the actual Phase 0 handover.

### Devnet lifecycle rehearsal

`scripts/devnet-lifecycle.cjs` is the end-to-end proof that the bonded
quorum works outside localnet. Localnet starts on a fresh program every run,
so the one transition it can never reproduce is the **first join on an old
account**: a verifier set allocated by the pre-Phase-3A program (bare-pubkey
layout, 246 bytes) must realloc to the current member-with-stake layout
(302) while an empty `Vec` decodes identically under both. On 2026-10-05
the full arc ran against the deployed devnet state, all assertions green:

| Step | Live devnet result                                                              |
| ---- | ------------------------------------------------------------------------------- |
| 1    | seat-a joins → **realloc 246 → 302 bytes fired**, stake recorded 5 USDC         |
| 2    | seat-b joins → set stands at `k`                                                |
| 3    | seat-a self-exit → **refused** (`DropBelowQuorum`)                              |
| 4    | farm + report-1; a and b approve → **Verified at quorum**, farm count 1         |
| 5    | governed reconfigure → **k 2→3, bond 5→7**                                      |
| 6    | seat-c joins at 7 → **recorded stakes [a@5, b@5, c@7]** — reprice untouched a/b |
| 7    | seat-c self-exit at 3 members/k=3 → **refused**                                 |
| 8    | report-2; a, b approve → open tally **2/3** under k=3                           |
| 9    | governed reconfigure → **k 3→2 beneath the open tally**                         |
| 10   | seat-c approves → **freeze finalises report-2 without recording c's ballot**    |
| 11   | seat-c exits above the floor → **refunded its recorded 7 USDC**                 |
| 12   | release b → **refunded 5, set drops to 1 member** (the valve)                   |
| 13   | b rejoins → **at the current price of 7**                                       |

End state: k=2, members `a@5 + b@7`, bond vault 12 USDC, both reports
Verified (report-2 via freeze), `farm.verified_report_count = 2`, account
layout 302 bytes. Every step is guarded by on-chain state, so re-running
the script after an RPC failure resumes instead of double-spending (the
public endpoint's 429s hit twice mid-run; the script absorbed both).
Not covered: `reward_report` — devnet has no reward vault (the
`reward_authority` PDA holds no token accounts) and inventing a reward
mint just to tick the box would be theatre. The preflight-only variant is
`scripts/devnet-state.cjs` (read-only: layout, rules, membership, balances).

### Switchboard job-spec proof (Phase 3B — standalone, off-chain)

The mandated order was: prove the job spec **before** any program wiring —
one on-demand job, one fixed farm/season on devnet, pull an update, verify a
correct cumulative-rainfall receipt entirely off-chain, no Anchor instruction.
Verdict: **tractable — 9/9 checks yes** (probe workspace
`/tmp/opencode/sb-jobspec`, full log in `LOG.md` there; the workspace is
scratch, so what the repo keeps is the outcome and the re-runnable relay
script below).

- **Job** — Open-Meteo daily `precipitation_sum` over the fixed season
  2024-04-01…2024-09-30 (183 terms), **mean × 183**: the deployed oracle
  build rejects `aggregationMethod` SUM/MEAN, so the total is computed as
  mean × count (deterministic for a closed archive window).
- **Feed hash** — `0x1e70a1ea0099fc2c5146d332ecd10824ba421cc2480ba74828640e94f3f84623`,
  computed locally with `FeedHash.computeOracleFeedId` (public crossbar has
  no DNS record, so no hosted lookup was possible). Canonical quote account:
  `7bdFFmzdwnfzntEzYbo5nQRiq7dgHcv8FjkpLhRrqJUQ` (derivable by anyone).
- **Receipt** — 3/3 enclave signatures verified with tweetnacl over the exact
  81-byte message (`slothash(32) ‖ feed_hash(32) ‖ i128 LE value(16) ‖
min_samples(1)`), each signer matched to its oracle's on-chain enclave
  record; value `22_200_000_000_000_000_000` = **22.2 mm** at the job's 1e18
  scale. The SDK exposes no `verify*()` API — verification was manual over
  the reconstructed message.
- **Cost** — one update round trip + on-chain quote write: **6,076,816
  lamports** (probe tx `DoCPiJbA…oQ17`).

Caveats carried forward: gateways must be discovered from on-chain oracle
records and probed for health (crossbar is DNS-dead); gateway rounds do not
always reach 3 responding signers (retry until they do); the SDK's 65535
"current instruction" sentinel is rejected by the deployed quote program
(`instructionIdx: 0` + a hand-built v0 transaction is the workaround — our
instruction accepts either sentinel, and the localnet suite pins the 65535
form); and quote-SDK transactions need explicit CU/priority-fee ixs, which
the relay does not (its instruction fits the default budget).

### Switchboard relay on devnet (Phase 3B — on-chain)

With the job spec proven and both instructions landed (25 → 27),
`programs/indorse_program/scripts/switchboard-reading.cjs` closes the loop
against live devnet. State-guarded and re-runnable like the lifecycle script:

1. seat the canonical quote account on the devnet oracle set (admin) — skip
   if already seated;
2. pull one fresh receipt from a live gateway (crossbar bypassed), decode its
   ed25519 precompile instruction and verify **every** signature, the feed
   hash, and each signer against its oracle's **on-chain** enclave record
   (retrying until ≥3 distinct signers — the quorum the protocol demands);
3. register the binding with those signers (admin, idempotent);
4. relay `[ed25519 ix, submit_switchboard_reading]` — the bootstrap wallet
   signs only as relayer/fee-payer;
5. read the tally back and assert the value.

Result on 2026-10-05: receipt at slot 507672122, 3 distinct signers verified,
signed value `22_200_000_000_000_000_000` → **22.2 mm landed under the feed's
seat** in season 1711920000's tally (relay tx `5cfMd1pv…RUS8`,
`finalized = false` — one of three seats). Localnet covers the other side:
9 integration cases (registration gates, missing proof, impostor signers,
foreign job hash, stale slothash, fractional value, the permissionless happy
path, the median freeze with a late-receipt refusal, and key rotation) — 44
in total. The script needs the probe workspace's Switchboard SDK
(`SWB_DEPS=/tmp/opencode/sb-jobspec/node_modules`, the default).

### Generated client

`lib/generated/indorse` is a [Codama](https://github.com/codama-idl/codama)-rendered
`@solana/kit` client for that same IDL: one builder per instruction, PDA finders,
typed account codecs, event decoders and error codes. It is committed source, so
neither the app build nor Metro needs the Codama toolchain — only regeneration
does:

```bash
npm run client:generate
```

The renderer is pinned to `@codama/renderers-js@2.4.0`, the last release that
emits imports for the **kit v7** codecs this app is on (`@solana/codecs-strings@^7`);
newer versions target kit v8. `lib/program/generated-client.test.ts` asserts the
generated client and the hand-rolled `lib/program/*` client agree on the program
address, every instruction discriminator, the argument encoding and the PDA
seeds, so drift between them fails the suite.

---

## AI services

All three AI jobs run through `npm run api:dev` (one origin, Vercel-function
compatible; provider keys stay server-side) and are switched per route from
Expo public env:

| Route                       | Client env                     | Backends                                       | Job                                               |
| --------------------------- | ------------------------------ | ---------------------------------------------- | ------------------------------------------------- |
| `POST /api/classify`        | `EXPO_PUBLIC_AI_CLASSIFY_URL`  | OpenAI Responses ⇄ Gemini (strict json_schema) | Photo diagnosis, ≤5 shots in one `images[]` call  |
| `POST /api/classify-gemini` | same                           | Gemini `generateContent` ⇄ OpenAI              | Same contract; what the device uses today         |
| `POST /api/grade`           | `EXPO_PUBLIC_AI_GRADE_URL`     | Gemini `flash-lite` + Groq `gpt-oss-120b`      | Dual-model harvest grade (batch record, no photo) |
| `POST /api/assistant`       | `EXPO_PUBLIC_AI_ASSISTANT_URL` | Groq `gpt-oss-120b` → OpenAI                   | Grounded "Ask indorse" guide                      |

⇄ = ordered failover between two providers with the same wire contract; → =
primary plus a fallback model. See _Surviving a moved origin and a provider
outage_ below.

### Surviving a moved origin and a provider outage

Two failures are routine in this setup and neither should reach the user as
an error: the API origin moving under a running app, and one provider hitting
a quota wall.

- **Origin failover (client).** `installResilientFetch()`, called once from
  `app/_layout.tsx`, wraps the global `fetch`. Foreign origins — Solana RPC,
  CDNs — pass straight through. A URL on one of ours is rewritten to the
  currently pinned origin before the first attempt; if it then fails to
  _connect_ (dropped adb reverse, a moved DHCP lease — never an HTTP response,
  even a 5xx) it re-races the configured origin against
  `EXPO_PUBLIC_API_FALLBACKS` and retries **exactly once** on whichever
  answered. Nothing is invented: with no configured URL the features disable
  themselves exactly as before. Source: `lib/api-origin.ts`, `lib/api-net.ts`.
- **Provider failover (server).** `api/_lib/balance.ts` runs an ordered list
  of attempts and answers from the first that succeeds — `classify`
  OpenAI ⇄ Gemini, `classify-gemini` Gemini ⇄ OpenAI, `assistant`
  Groq → OpenAI. A client fault (`bad-request`) fails fast, because every
  provider would reject the same payload, and a total outage reports the
  **primary's** error so the route's contract never changes shape.
- **One shared deadline (server).** Independent per-provider timeouts would
  make the failover dead code: a stalled primary consumes the whole invocation
  (and the app's own client deadline) before the fallback is ever dialled. Each
  classify route now passes `totalMs: CLASSIFY_TOTAL_BUDGET_MS` (42 s) and caps
  only its **primary** at that provider's deadline, so the fallback spends
  whatever time is left — a primary that fails in 2 s hands ~40 s to its
  sibling. The total sits under the app's `CLASSIFY_TIMEOUT_MS` (45 s) and the
  platform's 60 s `maxDuration`. `assistant` follows the same shape:
  `ASSISTANT_TOTAL_BUDGET_MS` (26 s) split into a 12 s `primary` ceiling and
  the remainder for the fallback, all beneath its `DEFAULT_ASSISTANT_TIMEOUT_MS`
  (30 s) client deadline — `api/assistant.test.ts` pins that ordering.
- **Camera reachability chip.** Probes retry 5× at 2.5 s, so a tunnel flap is
  absorbed while the sheet is still open instead of leaving the chip red.

### Diagnosis carries the full plant identity

The vision schema now also answers `commonName`, `botanicalName` and
`pathogenName` (e.g. Maize · _Zea mays_ · _Ustilago maydis_), rendered on the
camera result card between the verdict and the confidence. All three are
app-layer display fields like `severity`/`notes` — only the ≤32-byte label
reaches the chain as `aiLabel`. Parse edge is lenient by design: a missing,
non-text or over-long name is dropped rather than failing a verdict the
farmer is waiting on (abiotic findings legitimately have no pathogen, so
`""` → field absent). Proven live on the two test photos: `sc-healthy.jpeg`
→ Healthy 0.95 with no pathogen; `sc-sick.jpeg` → Corn Smut 0.95 with
_Ustilago maydis_.

### Scouted plants, recorded per season

That identity now outlives the camera. A capture stamps `plant` (the model's
`commonName`, else its `botanicalName`) and `timestamp` (epoch seconds, the
twin of the display date) onto its log row, and the Scout screen folds the
log into **season sections** — so a farm reads as "what was scouted, and in
which season", rather than one flat newest-first list.

- **Seasons are derived, never stored.** Each row is passed through
  `seasonForLocation(lat, lng, at)` — the same function the Profile tab's
  season row uses, so the two can never disagree — from **its own**
  coordinates and timestamp. No account, instruction or PDA is involved;
  the program was not touched.
- **Nothing is dropped.** A row with no timestamp (written before the field
  existed) or unusable coordinates cannot be placed honestly, so it keeps
  its place under an `Undated` heading instead of vanishing.
- **Headings only when they say something.** One section means every row
  shares a season, so the log renders exactly as it did before. Sections
  come back newest-season-first; rows inside keep the log's own order.
- **Display-only stays display-only.** `plant` never joins the anchor
  payload — `submit_scout_report` still receives only the ≤32-byte `aiLabel`,
  and a row read from chain alone (a fresh install, another scout's report)
  claims no plant rather than borrowing one.

Source: `features/reports/season-log.ts` (+ 13-case test), with the stamp in
`components/camera-overlay.tsx`, the chain mapping in
`features/reports/chain-events.ts` and the fold in `app/(tabs)/index.tsx`.

### Harvest grading — two models, one grade, one flag

`submit_harvest_batch` now carries `grade u8` (0 = ungraded, 1–4 = A–D),
`grade_confidence u8` (0–100), `grade_notes` (≤64 UTF-8 bytes) and
`grade_flags` (bit 0 = the models disagreed → a human verifier must look).
The grade is written **in the same transaction** as the batch, so provenance
and its assessment can never diverge.

- **Combine rules** (`api/_lib/grade.ts`): both agree → averaged confidence;
  disagree → keep the higher-confidence grade, take the **minimum**
  confidence, always set the flag; one model answers → `single`, flagged
  below 0.5 confidence.
- **Failure never blocks a harvest**: one grading attempt, then an explicit
  "Submit without a grade" escape — grade 0 is an honest "ungraded", not a
  fabricated average.
- Gated: `anchor test` 47/47 with the grade fields; full vitest suite green.
  Old devnet batches sit under orphaned pre-multi-farm farms, so the struct
  growth is safe ahead of the redeploy.

### Ask indorse — a grounded assistant, not an oracle

One floating robot chip (`components/help-chip.tsx`) sits over all four tabs
(bottom-left, clear of the Scout dock) and opens a chat sheet
(`components/assistant-sheet.tsx`) that sends the screen's question, this
farm's state and the active policy figures.

- **Knowledge first, doc second** (`api/_lib/knowledge.ts`): one
  hand-written document audited line by line against what is actually
  mounted — a test asserts it never names unmounted features (no
  `api/weather`) and never quotes an internal route path, because the doc
  is what a farmer reads.
- **Context, honestly partial**: route, farm existence/name, policy
  status/cover/trigger/finalized-rainfall only — allowlisted and clipped
  server-side, and fields are omitted while their chain query is still
  loading instead of guessed.
- **Guardrails** (prompt + handler): explain-only, never builds/signs/sends
  a transaction, no payout promises, says "I don't know", plain text only
  (markdown stripped server-side), en/es/fr, 1000-char messages, 30 requests
  per minute per IP → 429.
- **The failure that shaped the doc**: the first live answer inverted the
  payout mechanic ("rainfall must _exceed_ the trigger") because the doc
  never stated the direction. The program pays strictly **below**
  (`rainfall_mm < trigger_mm`); the doc now says so twice and a regression
  test pins the direction.

### AI environment

- Server: `GROQ_API_KEY` (grading second opinion + assistant; optional
  `GROQ_MODEL`) alongside `GEMINI_API_KEY`/`OPENAI_API_KEY`. Both of the
  latter now carry the classify routes as primary _and_ failover for each
  other, so either one alone is enough to keep diagnosis up; the assistant
  needs `GROQ_API_KEY` and/or `OPENAI_API_KEY` (optional
  `OPENAI_ASSISTANT_MODEL`, defaulting to the vision model). The Groq key
  was pasted in chat during setup — rotate it if that transcript was ever
  shared; keys live only in the untracked `.env`.
- Device: `EXPO_PUBLIC_AI_GRADE_URL` and `EXPO_PUBLIC_AI_ASSISTANT_URL`
  next to `EXPO_PUBLIC_AI_CLASSIFY_URL`, plus the optional
  `EXPO_PUBLIC_API_FALLBACKS` candidate list the origin race probes. The
  host LAN IP moved to
  `192.168.245.156` (the old `192.168.1.47` is dead) — all three URLs were
  updated and `adb reverse tcp:3000 tcp:3000` re-attached; Metro must
  restart to pick up `.env` changes.

---

## Project structure

```
indorse/
├── app/
│   ├── _layout.tsx          # Root layout — theme, language, settings, AuthProvider + AuthGate, wallet, farm registry, scout log
│   ├── index.tsx            # Entry redirect → /onboarding
│   ├── onboarding.tsx       # 3-slide intro + wallet connect CTA
│   ├── setup.tsx            # First-run setup wizard
│   ├── settings/
│   │   ├── notifications.tsx # Push / badge / category / quiet-hour switches
│   │   ├── security.tsx     # Wallet session, signature confirmations, app passcode, hide balances, auto-lock
│   │   ├── account.tsx      # Account & local data — what "delete" erases (device stores, wallet session)
│   │   ├── network.tsx      # Cluster picker + live getSlot health check
│   │   ├── export.tsx       # CSV farm record preview (live chain reads) → share or copy
│   │   ├── language.tsx     # English / Español / Français
│   │   └── theme.tsx        # System / Dark Field / Light Paper
│   └── (tabs)/
│       ├── _layout.tsx      # App header + custom Scout/Provenance/Weather/Profile tab bar
│       ├── index.tsx        # Scouting — onboarding card (no farm) or tiles, field status, log, banner, camera
│       ├── farms.tsx        # Provenance — score, evidence banner, escrow, addresses
│       ├── reports.tsx      # Weather — policy, oracle (error + retry), season chart
│       └── rewards.tsx      # Profile — wallet state, farm details, activity, settings destinations
│
├── components/
│   ├── app-providers.tsx    # QueryClient + theme + language + settings + MobileWalletProvider
│   ├── app-header.tsx       # Brand header: PDA, notification bell, avatar, farm pill
│   ├── app-splash.tsx       # Splash while the registry/providers hydrate
│   ├── auth-gate.tsx        # Full-screen lock modal: create passcode / unlock (+ biometrics)
│   ├── auth-provider.tsx    # App lock state: salted verifier in SecureStore, attempts, auto-lock
│   ├── camera-overlay.tsx   # Full-screen scouting camera overlay — captures stay local without a farm
│   ├── confirm-modal.tsx    # Shared destructive-action confirm sheet
│   ├── farm-registry-provider.tsx # On-chain + local-only farms, current-farm selection
│   ├── farm-switcher-sheet.tsx    # Switch between registered farms
│   ├── log-harvest-modal.tsx / setup-escrow-modal.tsx / underwrite-policy-modal.tsx / verify-email-modal.tsx
│   ├── notifications.tsx    # Notification context + bottom sheet (starts empty; push/category aware)
│   ├── profile-provider.tsx # On-device operator profile (name, bio, photo)
│   ├── register-farm-modal.tsx     # name + GPS (chain or local-only when disconnected)
│   ├── scout-onboarding.tsx # "Set up in 3 steps" entry card + scan-now info box (no-farm state)
│   ├── scout-log-provider.tsx # Device's scouting log (`indorse.scout.v1`) — captures persist, anchor later
│   ├── IndorseMark.tsx / person-icon.tsx # Brand mark + line-drawn avatar
│   ├── screen-kit.tsx       # Banner / EmptyState / ErrorState / Skeleton / Chip / RiskBar
│   ├── seed-vault-badge.tsx # Seeker seed-vault badge
│   ├── settings-provider.tsx # Persisted prefs: notifications, security, network
│   ├── settings-ui.tsx      # SettingsScreen / Group / Row / ToggleRow / OptionRow + sheet / button
│   ├── theme-provider.tsx   # Light / Dark / System mode, persisted, drives every makeStyles
│   └── ui.tsx               # Shared Card / FieldGrid / Badge primitives
│
├── lib/
│   ├── csv.ts               # Farm record → flat CSV (union header, record_type column, honest empty cells)
│   ├── format.ts            # toE6/fromE6, timestamps, USDC, shortenAddress
│   ├── i18n.tsx             # Language context + t() with {placeholder} interpolation
│   ├── translations/        # en / es / fr dictionaries, typed to MessageKey
│   ├── program/             # codec, PDA derivations, instruction builders, RPC helpers, SAS
│   ├── idl/                 # App-facing copy of the program IDL (refresh with npm run idl:sync)
│   ├── validation.ts        # Shared per-field validation helpers
│   └── wallet-name.ts / display-name.ts / greeting.ts / seeker.ts / skr.ts
│
├── constants/
│   ├── app-config.ts        # Cluster URLs, default cluster, rpcUrl()/buildCluster(), identity
│   ├── data.ts              # Design-era seed/fixture data — asserted unrendered by the screens
│   └── theme.ts             # Design tokens (dark + light palettes, Colors, sevFor, spacing, radii)
│
├── features/
│   ├── wallet/              # useMobileWalletSetup, useWalletMutation, device verification (SIWS/SGT)
│   ├── farm/                # Farm account, register/delete mutations, validation
│   ├── reports/             # ScoutReport, submit/verify mutations, chain → UI event mapping
│   ├── scout/               # Field derivation from reports, location helpers
│   ├── harvest/             # HarvestBatch, submit_harvest_batch mutation
│   ├── escrow/              # Escrow, create/release/cancel mutations, EscrowCard
│   ├── insurance/           # Policy + weather trigger types, oracle reads, mutations
│   ├── ai/                  # Photo classification client + verdict schema shared with api/
│   ├── email/               # Verification-email client for the api/ proxy
│   └── profile/             # Setup signals + profile types
│
├── api/                     # Vercel-style functions: AI classify (OpenAI/Gemini), SIWS, email, SAS
├── programs/
│   └── indorse_program/     # Anchor workspace (Rust program + integration tests + init-config/role-keys scripts)
│
├── *.test.tsx / **/*.test.ts  # 87 suites — see Build process → Test strategy
├── test/setup-mocks.ts       # Shared test mocks (icon set, expo-crypto digest)
├── test/bundle-guard.test.ts # Fails if any test file lands under app/ (Metro would bundle it)
├── test/eas-guard.test.ts    # Fails if a build profile drops the FORCE_SEEKER pin or swaps AAB/APK
├── test/smoke.test.ts        # Opt-in live-RPC round trip (SMOKE_RPC)
├── vitest.config.mts         # Vitest config (verbose reporter, vitest-native)
├── eas.json                  # EAS build profiles — see Build process → Release builds (EAS)
└── package.json
```

---

## Using the wallet

`useMobileWallet()` from `@wallet-ui/react-native-kit` is available anywhere
below `AppProviders`. For most UI work, use the higher-level
`useMobileWalletSetup` hook from `features/wallet`:

```tsx
import { useMobileWalletSetup } from '@/features/wallet'

const { walletState, address, toggleConnection, error } = useMobileWalletSetup()
```

Or drop in the ready-made button:

```tsx
import { WalletConnectButton } from '@/features/wallet'

;<WalletConnectButton onConnected={(address) => console.log(address)} />
```

For transaction mutations, use the shared `useWalletMutation` factory — it
handles validation, the connected-wallet check and error wrapping:

```tsx
import { useWalletMutation } from '@/features/wallet'

useWalletMutation<Input, Result>({
  actionLabel: 'register farm',
  validate: validateRegisterFarm, // optional
  action: async (input, address) => {
    // build + send the transaction
  },
})
```

For raw wallet access (RPC calls, signing):

```tsx
import { useMobileWallet } from '@wallet-ui/react-native-kit'

const { account, client, connect, disconnect, sendTransactions, signMessages } = useMobileWallet()
// account is null until connected; client.rpc is a @solana/kit RPC client
```

---

## Settings

The Profile tab's **Settings** card opens eight screens: seven routes under
`app/settings/`, plus `/legal`:

| Screen             | What it does                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Notifications      | Push master switch, unread badge, per-category toggles (diagnosis / escrow / weather / system), quiet hours                                |
| Wallet & Security  | Session status, disconnect, app passcode (change / forgot), confirm-signatures / biometrics, **hide balances**, auto-lock                  |
| Account            | Account & local data — spells out exactly what "delete" erases (on-device stores + wallet session; on-chain records are untouched)         |
| Network            | mainnet / devnet / testnet / localnet / custom RPC with a real `getSlot` health check (latency + slot)                                     |
| Export Farm Record | Live chain record → flat CSV preview with row counts → share via `expo-sharing` or copy to clipboard                                       |
| Language           | English / Español / Français                                                                                                               |
| Theme              | System / Dark Field / Light Paper                                                                                                          |
| Terms & Privacy    | Terms of Use and Privacy Policy with a tab switch, version and date stamped on every screen — `app/legal.tsx` renders `constants/legal.ts` |

**Terms & Privacy** — `constants/legal.ts` holds both documents as plain data,
so the wording lives in one place; the screen only lays it out. The wording
describes what indorse does today: if a data flow changes, edit it there, bump
`LEGAL_VERSION` / `LEGAL_UPDATED`, and keep `api/_lib/knowledge.ts` in step
(the assistant's answers about legal text come from that file, not from a
read of this one). Consent is collected once, on the onboarding welcome screen —
**Enter App** stays behind an **"I have read and agree to the Terms of Use and
Privacy Policy"** checkbox whose two document names are live links to their
tabs. `OPERATOR_NAME` and `GOVERNING_LAW` are filled in; `CONTACT_EMAIL` still
ships as a visible `REPLACE:` placeholder in all three places it is printed.

Everything the screens edit lives in `components/settings-provider.tsx` as one
AsyncStorage document, so other parts of the app react to it: the notification
sheet only lists categories that are enabled, the profile masks balances when
`hideBalances` is on, and switching cluster remounts `MobileWalletProvider`
(the screen warns that the wallet session drops).

**Theme** — `ThemeProvider` persists the mode and exposes `colors`; screens
build styles with `makeStyles(colors)` so light mode is a palette swap, not a
second stylesheet. System mode follows `useColorScheme()`.

**Language** — `LanguageProvider` persists the locale; `t('key')` looks the
string up in `lib/translations/{en,es,fr}.ts`. The dictionaries are typed as
`Record<MessageKey, string>`, so a key added to English but missing from
Spanish or French fails `tsc`. Seed data (crop names, diagnoses, addresses)
stays in English on purpose.

**App lock** — `AuthProvider` gates the app like a wallet does: first launch
asks for a passcode (stored as a salted SHA-256 verifier in
`expo-secure-store`, never the wallet key), every return asks for it again —
or for Face ID / fingerprint when the device supports it and **biometrics** is
switched on — and five wrong tries pause the form for 30 seconds. The
`auto-lock` preference decides when backgrounding re-locks. Signing still goes
through Mobile Wallet Adapter, so the passcode protects the _app_, not the
keys.

**CSV export** — `lib/csv.ts` emits one union header with a `record_type`
column (farm, field, scout_event, escrow, weather_policy), RFC 4180 quoting,
`farmRecordRowCount()` for the row count and a slugified `farmRecordFileName()`.

---

## Scripts

```bash
# Dev loop
npm run dev             # Metro (clear cache, dev client)
npm run android         # Build and run on a device or emulator
npm run api:dev         # AI proxy + SIWS routes on localhost:3000
npm run up              # preflight → api:dev → Metro → adb reverse → verify

# Quality gates (all four must be green before any handoff)
npm run test            # Vitest, verbose pass/fail output
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Run tests with V8 coverage report
npm run lint:check      # expo lint (npm run lint to autofix)
npm run format:check    # prettier --check . (npm run format to write)
npm run ci              # tsc + lint + format + test + Android prebuild

# On-chain
npm run idl:sync        # Copy the freshly built IDL into lib/idl/
npm run sas:bootstrap   # Solana Attestation Service bootstrap

# Misc
npm run doctor          # expo-doctor
npm run icons           # Regenerate the app icons
```

---

## Running Anchor tests

The integration tests (47 cases: config authority rotation, the K-of-N
verifier set — quorum approve/reject, double-vote refusal, governed
reconfiguration with its bounds, the `k`-member exit floor, reprice-then-join
stake accounting, the admin release valve, the governed slash, and
freeze-on-contact when `k` is lowered mid-tally — the oracle-set median —
admin-only odd quorum, seat assignment/refusal, partial-tally settle refusal,
own replacement and the final freeze — the Switchboard receipt relay —
binding registration gates (including the >`MAX_ORACLES` signers refusal),
missing proof, impostor signers, foreign job hash, stale slothash, fractional
value, the permissionless happy path, the median freeze and key rotation —
program-treasury revoke/withdraw, scouting, rewards, treasury-pool insurance
with both settle paths pressed by an unfunded stranger (refund and breach
payout), the treasury-can-fund refusal at creation (an underfunded vault
can no longer be built), the settled-policy close (sweep,
rents, and the Active refusal), escrow cancel/retry, and the multi-farm
roster — a second farm on the same wallet at the counter-derived slot)
need a local validator and the Anchor CLI. Plain `anchor test` tries to
drive Surfpool in Anchor 0.32; where Surfpool does not start (it needs a
TTY this environment does not give it), the same command runs against the
classic validator with `--validator legacy` — proven green at 47/47 on
2026-10-05 and again on 2026-10-07 (fresh validator, after the
coverage-funding change). The manual recipe below remains as the fallback for environments
where even that flag is unavailable. Note that Agave ≥ 2.2 rejects _new_
loader-v3 programs on a local validator, so the manual path deploys with
`program-v4`:

```bash
cd programs/indorse_program
anchor build                                   # compile + regenerate IDL/types
solana-test-validator --reset &                # localnet
solana program-v4 deploy target/deploy/indorse_program.so \
  --program-keypair target/deploy/indorse_program-keypair.json
anchor test --skip-local-validator \
  --provider.cluster http://127.0.0.1:8899 --skip-build --skip-deploy
```

---

## Smoke test (live RPC)

`test/smoke.test.ts` exercises the app's own client end-to-end —
`buildInstruction` → kit signing → send → confirm → `fetchAccount`
round-trip — by registering a farm and submitting one scout report, then
asserting the decoded accounts match. It is skipped unless `SMOKE_RPC` is
set, so the offline gate never touches a network:

```bash
SMOKE_RPC=http://127.0.0.1:8899 npx vitest run test/smoke.test.ts
SMOKE_RPC=https://api.devnet.solana.com npx vitest run test/smoke.test.ts
```

It signs with `~/.config/solana/id.json` (override with `SMOKE_KEY`); the
wallet needs SOL on devnet, while a local validator's faucet tops it up
automatically. The suite is idempotent — an existing farm is reused and
each run appends one report at the farm's next free index.

---

## Changing the cluster

Edit `constants/app-config.ts`:

```ts
import { createSolanaDevnet, createSolanaMainnet } from '@wallet-ui/react-native-kit'

static cluster = createSolanaDevnet({ url: 'https://api.devnet.solana.com' })
// or:
static cluster = createSolanaMainnet({ url: 'https://api.mainnet-beta.solana.com' })
```
