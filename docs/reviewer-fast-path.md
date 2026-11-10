# Reviewer fast path

Fastest way to recheck this project end to end (~5 minutes, read-only).

## 1. The contract (2 minutes)

- Contract: see `deployment.json` (`contractAddress`, `deployTxHash`,
  `contractSha256`, `deployedCodeSha256`).
- Open the explorer link in `deployment.json` and confirm the deploy
  transaction is `FINALIZED`.
- Recompute the source hash:
  `sha256sum contracts/milestone_fund.py` — it must equal
  `contractSha256` in `deployment.json`, and `deployedCodeSha256`
  must equal it too (the deployed code was read back with
  `gen_getContractCode` and compared byte for byte).

## 2. The live state (2 minutes)

With `genlayer-js` (or any Studionet RPC client) against
`https://studio.genlayer.com/api`, chain 61999:

- `get_count` → `3`
- `get_campaign(0)` → campaign `0`, goal `20000000000000000000` wei
  (20 GEN), `total_backed_wei` the same, `escrow_wei` `0`, all three
  milestones settled:
  - milestone 0 `ACCEPT`, released `9000000000000000000` wei (9 GEN —
    8 GEN milestone + 1 GEN forfeited challenge stake), refunded `0`,
    status `RELEASED`
  - milestone 1 `REJECT`, released `0`, refunded
    `8000000000000000000` wei (8 GEN, payouts 4.8 / 3.2 GEN),
    status `REFUNDED`
  - milestone 2 `PARTIAL`, released `2000000000000000000` wei
    (2 GEN), refunded `2000000000000000000` wei (2 GEN,
    payouts 1.2 / 0.8 GEN), status `PARTIAL_RELEASED`
- `get_campaign(1)` → goal 8 GEN, `total_backed_wei` 8 GEN,
  `escrow_wei` `0`: milestone 0 `ACCEPT` final (round 1 `REJECT`,
  challenge round 2 `ACCEPT`, resolve round 3 `ACCEPT` — 3
  evaluations kept), released 3.5 GEN; milestone 1 `REJECT`,
  released `0`, refunded 4 GEN (payouts 2.5 / 1.5 GEN).
- `get_campaign(2)` → `CANCELLED`, `total_backed_wei` 4 GEN,
  `escrow_wei` `0`.
- `get_totals` → `total_received_wei`
  `45000000000000000000` (45 GEN), `total_withdrawn_wei` the same,
  `credits_outstanding_wei` `0`, `escrow_locked_wei` `0`,
  `contract_balance_wei` `0`, `invariant_ok` `true`.
- `get_supporter_board(10)` → backer B backed 21 GEN in history
  (12 + 5 + 4), backer C backed 11 GEN, creator created 3
  campaigns, backer C won 1 challenge and lost 1.
- Money check: the four final EOA balances in `evidence.json`
  (10,014.5 + 9,991.5 + 9,994 + 10,000 GEN) sum to 40,000 GEN —
  exactly the four faucet fundings of 10,000 GEN.

## 3. The evidence (1 minute)

- `evidence.json` — every core transaction hash with its `FINALIZED`
  receipt status, the final campaign records, final credits,
  withdrawals, and the money reconciliation. The superseded earlier
  contracts are noted there with address, deploy hash, and reason.
- `evidence/live-verification.json` — the same record, kept with the
  receipts.
- `tests/local_tests.py` — 179 local mock tests (pure SHA-256 vs
  hashlib, date math, verdict truth table, full lifecycle money math
  in wei, frozen/resolve path, staleness gate, verdict-level
  consensus, failed-payable refunds). Run with
  `python3 tests/local_tests.py`. These are local mocks, not on-chain
  evidence; the on-chain flow is `scripts/flow.mjs` and the
  independent read-back is `scripts/verify.mjs` (75 checks, all
  passing — run `node scripts/verify.mjs`).

## 4. The mechanism question

- `docs/mechanism.md` — the worst-case spread calculation: consensus
  is over the verdict derived from the flags, not the raw flags, so
  two validator-compatible leader outputs differ by `0` in verdict
  and `0` GEN (their flag vectors may differ within one verdict).
  A split that changes the verdict cannot settle at all.
