# indorse

A Solana mobile dApp for decentralised farm scouting, built with
[Expo](https://expo.dev) and the
[Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview)
via [`@wallet-ui/react-native-kit`](https://www.npmjs.com/package/@wallet-ui/react-native-kit).

Mobile Wallet Adapter is **Android-only**, so connecting a wallet requires an
Android device or emulator with a wallet app (e.g. Phantom, Solflare) installed.

---

## Getting started

```bash
npm install
npm run android
```

---

## On-chain program

The Anchor program lives in `programs/indorse_program/` and exposes four
instructions:

| Instruction              | Description                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `register_farm`          | Create a farm PDA seeded by `[b"farm", owner]`                                                                                    |
| `submit_scout_report`    | Submit a field photo report for a farm                                                                                            |
| `verify_scout_report`    | Approve or reject a pending report (admin only)                                                                                   |
| `reward_report`          | Pay SKR tokens to the reporter (admin only, one payout)                                                                           |
| `submit_harvest_batch`   | Record a harvest batch with provenance snapshot                                                                                   |
| `create_escrow`          | Buyer deposits USDC into escrow for a batch                                                                                       |
| `release_escrow`         | Farmer claims the escrowed funds                                                                                                  |
| `cancel_escrow`          | Buyer cancels before lock — escrow + vault are closed, USDC and rent refunded, batch slot freed for retry                         |
| `create_policy`          | Create a parametric weather-insurance policy (single farmer signature; the treasury tops up coverage with a plain token transfer) |
| `submit_weather_reading` | Oracle posts a season rainfall reading (admin only)                                                                               |
| `settle_policy`          | Pay out or expire a policy after the season ends (admin) — no-trigger refunds are constrained to the treasury's USDC account      |

**Program ID:** `GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht`

The IDL and TypeScript types are generated at:

- `programs/indorse_program/target/idl/indorse_program.json`
- `programs/indorse_program/target/types/indorse_program.ts`

The app consumes a copy at `lib/idl/indorse_program.json`; refresh it after any
program change with:

```bash
npm run idl:sync
```

---

## Project structure

```
indorse/
├── app/
│   ├── _layout.tsx          # Root layout — theme, language, settings, AuthProvider + AuthGate, wallet
│   ├── index.tsx            # Entry redirect → /onboarding
│   ├── onboarding.tsx       # 3-slide intro + wallet connect CTA
│   ├── settings/
│   │   ├── notifications.tsx # Push / badge / category / quiet-hour switches
│   │   ├── security.tsx     # Wallet session, signature confirmations, app passcode, hide balances, auto-lock
│   │   ├── network.tsx      # Cluster picker + live getSlot health check
│   │   ├── export.tsx       # CSV farm record preview → share or copy
│   │   ├── language.tsx     # English / Español / Français
│   │   └── theme.tsx        # System / Dark Field / Light Paper
│   └── (tabs)/
│       ├── _layout.tsx      # App header + custom Scout/Provenance/Weather/Profile tab bar
│       ├── index.tsx        # Scouting — tiles, field status, log, attention banner, camera
│       ├── farms.tsx        # Provenance — score, evidence banner, escrow, addresses
│       ├── reports.tsx      # Weather — policy, oracle (error + retry), season chart
│       └── rewards.tsx      # Profile — wallet state, farm details, activity, settings card
│
├── components/
│   ├── app-providers.tsx    # QueryClient + theme + language + settings + MobileWalletProvider
│   ├── app-header.tsx       # Brand header: PDA, notification bell, avatar, farm pill
│   ├── auth-gate.tsx        # Full-screen lock modal: create passcode / unlock (+ biometrics)
│   ├── auth-provider.tsx    # App lock state: salted verifier in SecureStore, attempts, auto-lock
│   ├── brand.tsx            # BrandMark logo
│   ├── camera-overlay.tsx   # Full-screen scouting camera overlay (scan → submit)
│   ├── notifications.tsx    # Notification context + bottom sheet (push/category aware)
│   ├── screen-kit.tsx       # Card / label / pill / risk bar + Banner, EmptyState, ErrorState, Skeleton
│   ├── settings-provider.tsx # Persisted prefs: notifications, security, network
│   ├── settings-ui.tsx      # SettingsScreen / Group / Row / ToggleRow / OptionRow + sheet / button
│   ├── theme-provider.tsx   # Light / Dark / System mode, persisted, drives every makeStyles
│   └── ui.tsx               # Shared Card / FieldGrid / Badge primitives
│
├── lib/
│   ├── csv.ts               # Farm record → flat CSV (union header, record_type column)
│   ├── format.ts            # toE6/fromE6, timestamps, USDC, shortenAddress
│   ├── i18n.tsx             # Language context + t() with {placeholder} interpolation
│   ├── translations/        # en / es / fr dictionaries, typed to MessageKey
│   ├── use-mock-fetch.ts    # loading → error → ready states pending real chain reads
│   ├── validation.ts        # Shared per-field validation helpers
│   └── wallet-name.ts       # Stable friendly wallet names (no raw pubkey in the UI)
│
├── constants/
│   ├── app-config.ts        # Cluster URLs, default cluster, rpcUrl()/buildCluster(), identity
│   ├── data.ts              # Seed data for the UI (fields, events, escrow, weather)
│   └── theme.ts             # Design tokens (dark + light palettes, Colors, sevFor, spacing, radii)
│
├── features/
│   ├── wallet/
│   │   ├── types.ts                  # WalletConnectionState
│   │   ├── useMobileWalletSetup.ts   # Friendly state + toggleConnection
│   │   ├── useWalletMutation.ts      # Shared factory for tx mutations
│   │   ├── WalletConnectButton.tsx   # Self-contained connect/disconnect button
│   │   └── index.ts                  # Barrel export
│   │
│   ├── farm/                # Farm account, register_farm mutation, FarmCard
│   ├── reports/             # ScoutReport, submit_scout_report mutation, ReportCard
│   ├── harvest/             # HarvestBatch, submit_harvest_batch mutation, HarvestCard
│   ├── escrow/              # Escrow, create/release/cancel mutations, EscrowCard
│   └── insurance/           # Policy + weather trigger types and helpers
│
├── programs/
│   └── indorse_program/             # Anchor workspace
│       ├── programs/indorse_program/src/lib.rs   # Rust program
│       └── tests/indorse_program.ts              # Anchor integration tests
│
├── auth.test.tsx             # App lock: registration, wrong passcode + cooldown, biometrics, reset
├── screens.test.tsx          # Render smoke tests for the four tab screens + notification sheet
├── settings.test.tsx         # Settings stack: prefs gate the feed, language/theme, network, CSV export
├── lib/csv.test.ts           # CSV escaping, column counts, row counts, file name
├── test/setup-mocks.ts       # Shared test mocks (icon set, expo-crypto digest)
├── vitest.config.mts         # Vitest config (verbose reporter, vitest-native)
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

The Profile tab's **Settings** card opens six routes under `app/settings/`:

| Screen             | What it does                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Notifications      | Push master switch, unread badge, per-category toggles (diagnosis / escrow / weather / system), quiet hours               |
| Wallet & Security  | Session status, disconnect, app passcode (change / forgot), confirm-signatures / biometrics, **hide balances**, auto-lock |
| Network            | mainnet / devnet / testnet / localnet / custom RPC with a real `getSlot` health check (latency + slot)                    |
| Export Farm Record | Flat CSV preview with row counts → share via `expo-sharing` or copy to clipboard                                          |
| Language           | English / Español / Français                                                                                              |
| Theme              | System / Dark Field / Light Paper                                                                                         |

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
npm run dev           # Start the dev server
npm run android       # Build and run on a device or emulator
npm run test          # Run the Vitest test suite (verbose pass/fail output)
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with V8 coverage report
npm run ci            # Type check + lint + format check + test + prebuild
```

---

## Running Anchor tests

The integration tests (16 cases: scouting, rewards, treasury-pool insurance,
escrow cancel/retry) need a local validator and the Anchor CLI. Plain
`anchor test` tries to drive Surfpool in Anchor 0.32; in environments where
Surfpool does not start, run against `solana-test-validator` directly. Note
that Agave ≥ 2.2 rejects _new_ loader-v3 programs on a local validator, so the
program is deployed with `program-v4`:

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
