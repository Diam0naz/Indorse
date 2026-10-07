# Cross-farm discovery — spec

Status: built (2026-10-07). Companion to `docs/services.md` § App-level
services.

## Why this exists

Farm PDAs are derived per owner (`["farm", owner, index]`), so nothing on
the chain can enumerate farms — a scout can only read farms whose address
they already know. Meanwhile the protocol has always allowed it:
`submit_scout_report` has **no owner gate**, any wallet can report on any
farm, and `reward_report` pays `report.reporter` — so a scout earning SKR
against someone else's farm was always legal. The gap was purely client:
no way to _find_ other farms, and the screen pinned every capture to the
featured (own) farm.

## Product decisions (user-confirmed)

| Question        | Decision                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface & flow  | A **Discover card on the Scouting tab** → tap a row → compact sheet (name, distance, counts, provenance score, exact coordinates) → **"Scout this farm"** arms a target shown as a badge on the dock; tapping the badge stands down |
| Privacy posture | **Chain-public, decision-ready**: the list shows name, distance, verified/total and score; the sheet may show exact coordinates. Everything is already public on-chain — the directory only makes it findable                       |

## Architecture

```
 FarmChainSync (roster sync)          Scouting tab
   │ publish own farms ▼                │ GET directory ▼
   ▼                                     │
 POST /api/directory ──► in-memory store ◄── GET /api/directory
   (server re-reads the Farm account        (stale rows > 60 s re-read,
    on devnet before storing:               stale row kept on RPC failure)
    a publish can only list real farms)
```

1. **Directory** (`api/directory.ts`) — `POST {farm}` verifies an address
   against devnet before storing (400 bad address / 404 not a farm / 429
   per-IP 30-per-min / 502 RPC outage); `GET` returns snapshots. In-memory
   by design: a restart starts empty and devices re-publish on their next
   sync (idempotent, self-healing).
2. **Publish** (`features/farm/FarmChainSync.tsx`) — after the wallet's
   roster mirrors into the registry, each chain-farm address publishes once
   per session; a failure drops it from the done-set so the next sync
   retries. No API origin configured → no-op (the single-URL rule,
   `lib/api-origin`).
3. **Derivation** (`features/farm/directory.ts`, pure) — roster farms are
   excluded (they belong to the switcher), haversine distance from one
   device fix (absent → distance-free, name order), `pending = reports −
verified` (clamped ≥ 0), `score = round(100·verified/reports)` or `null`
   while nobody reported; sort nearest-first, unknown position last.
4. **Scout target** (state in `app/(tabs)/index.tsx`) — session state:
   `{address, name} | null`. It affects only **new captures and their
   anchoring**. The featured farm keeps owning the log reads, field cards,
   tiles, profile totals — the registry stays "my farms".
5. **Queue stamping** (`ScoutAnchorPayload.farmAddress`, set by
   `CameraOverlay` from `queuedFarmAddress`) — a capture queued while a
   target is armed records the farm at capture time. The flush then: a
   stamped row anchors **there**, keeping its capture-time `field` name; an
   unstamped row anchors to the featured farm exactly as before (rows
   written before this feature carry no stamp → old behaviour). The flush
   tick is progress-driven, so a row with no farm to anchor to stays queued
   without spinning the effect.
6. **Camera wiring** — `farmAddress` (immediate chain submit) = target when
   the wallet is up, else the featured farm as before; `farmName` = target
   name (viewfinder label + row field); `queuedFarmAddress` = target
   regardless of wallet, so wallet-down captures still stamp.

## Additions after the first build

- **Register-free discovery** — the setup card no longer replaces the screen
  outright: the Discover card renders beside it, so a device with no farm
  (and no wallet) can browse the directory and arm a scout target before it
  ever registers. The camera wiring already expected exactly this — it reads
  `scoutTarget` with `farmAddress={null}` — so only the card was missing.
  Captures stamp the target and queue as before, and an on-chain submit
  still needs a wallet at flush time, which was always the real gate rather
  than registration.
- **Recency, read lazily** — the detail sheet now says when a farm was last
  reported on. The original spec assumed this would cost a read of every
  report account per farm; it costs one: reports are
  `["report", farm, u32(index)]` and `Farm` carries `reportCount`, so the
  newest account is addressable at `reportCount - 1`. The _list_ stays as
  cheap as it ever was — the read happens only when a sheet opens.

## Deliberately unchanged

- The on-chain program — no instruction, account or permission changed.
- The setup card still leads the no-farm screen and still owns
  registration — Discover was added beside it, not instead of it.
- Existing queued rows (no `farmAddress` in their payload) keep anchoring
  to the featured farm.
- Distance rounding / coordinate masking — rejected by the privacy
  decision above.

## Known edges

- The store is in-memory: after a server restart the list repopulates as
  devices sync; farms whose owner never re-syncs are absent until then
  (there is no possible global backfill — the chain cannot enumerate owners).
- No recency signal **in the list** — still true, and still deliberate: a
  per-row timestamp would mean one read per farm on every 60 s refresh. The
  sheet answers it lazily instead (one read, only when opened), and
  `pending` + `No reports yet` remain the list-level needs-scouting signals.
- The Discover card hides when the directory is empty — an empty network is
  not an error; only a failed load says so (`Directory unreachable` + retry).

## Test map

- `api/directory.test.ts` — verify-before-store, rate limit, TTL refresh,
  stale-row retention on RPC failure (7 cases).
- `features/farm/directory.test.ts` — haversine/format, endpoint rule,
  filter/sort/enrichment, shape guard, the two HTTP calls (12 cases).
- `screens.test.tsx › screen redesign` — card renders + roster exclusion,
  sheet → arm → badge → stand-down; the same sheet reachable with **no farm
  and no wallet** (register-free); directory error state; flush anchors a
  stamped capture to _its_ farm while an unstamped one keeps the featured
  farm (4 cases).
- `features/reports/useLatestReportTimestamp.test.ts` — the `reportCount - 1`
  index, null when that account is not on chain, no request at all for an
  empty farm (3 cases).
- `camera-overlay.test.tsx` — the queued payload stamps the target when
  set, and does **not** carry a farm when it isn't (2 cases).
