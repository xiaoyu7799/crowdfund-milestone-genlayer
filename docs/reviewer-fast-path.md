# Reviewer fast path

Fastest way to recheck this project end to end (~5 minutes, read-only).

## 1. The contract (2 minutes)

- Contract: see `deployment.json` (`contractAddress`, `deployTxHash`,
  `contractSha256`).
- Open the explorer link in `deployment.json` and confirm the deploy
  transaction is `FINALIZED`.
- Recompute the source hash:
  `sha256sum contracts/milestone_fund.py` — it must equal
  `contractSha256` in `deployment.json`.

## 2. The live state (2 minutes)

With `genlayer-js` (or any Studionet RPC client) against
`https://studio.genlayer.com/api`, chain 61999:

- `get_count` → `1`
- `get_campaign(0)` → campaign `0`, goal `10000`, `total_backed`
  `10000`, `escrow` `0`, all three milestones `FINALIZED`:
  - milestone 0 `ACCEPT`, released `4000`, refunded `0`
  - milestone 1 `REJECT`, released `0`, refunded `4000`
    (payouts `2400` / `1600`)
  - milestone 2 `PARTIAL`, released `1000`, refunded `1000`
- `get_leaderboard(10)` → creator reputation `100`, challenger
  reputation `95`.
- Money check: the three final balances in `evidence.json` plus
  escrow `0` sum to `30000` (three demo-fund claims of `10000`).

## 3. The evidence (1 minute)

- `evidence.json` — every core transaction hash with its `FINALIZED`
  receipt status, the final campaign record, final balances, and the
  money-conservation check.
- `evidence/live-verification.json` — the same record, kept with the
  receipts.
- `tests/local_tests.py` — 81 local mock tests (pure SHA-256 vs
  hashlib, date math, verdict truth table, full lifecycle money math,
  frozen/resolve path, staleness gate). Run with
  `python3 tests/local_tests.py`. These are local mocks, not on-chain
  evidence; the on-chain flow is `scripts/flow.mjs`.

## 4. The mechanism question

- `docs/mechanism.md` — the worst-case spread calculation: two
  validator-compatible leader outputs differ by exactly `0` in flags,
  verdict, and money, because validation requires exact flag-vector
  agreement and the verdict is computed from the agreed flags.
