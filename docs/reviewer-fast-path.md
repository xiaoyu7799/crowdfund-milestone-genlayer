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

- `get_count` → `1`
- `get_campaign(0)` → campaign `0`, goal `100000000000000000000` wei
  (100 GEN), `total_backed_wei` `100000000000000000000`,
  `escrow_wei` `0`, all three milestones settled:
  - milestone 0 `ACCEPT`, released `40000000000000000000` wei (40 GEN),
    refunded `0`, status `RELEASED`
  - milestone 1 `REJECT`, released `0`, refunded
    `40000000000000000000` wei (40 GEN, payouts 24 / 16 GEN),
    status `REFUNDED`
  - milestone 2 `PARTIAL`, released `10500000000000000000` wei
    (10.5 GEN), refunded `10500000000000000000` wei (10.5 GEN,
    payouts 6.3 / 4.2 GEN), status `PARTIAL_RELEASED`
- `get_totals` → `total_received_wei`
  `101000000000000000000` (101 GEN), `total_withdrawn_wei` the same,
  `credits_outstanding_wei` `0`, `escrow_locked_wei` `0`,
  `contract_balance_wei` `0`, `invariant_ok` `true`.
- `get_supporter_board(10)` → backer B backed 60 GEN, backer C
  backed 40 GEN, creator created 1 campaign.
- Money check: the three final EOA balances in `evidence.json`
  (10,050.5 + 9,969.3 + 9,980.2 GEN) sum to 30,000 GEN — exactly the
  three faucet fundings of 10,000 GEN.

## 3. The evidence (1 minute)

- `evidence.json` — every core transaction hash with its `FINALIZED`
  receipt status, the final campaign record, final credits, withdrawals,
  and the money reconciliation. The superseded earlier contract is
  noted there with its address and a one-line reason.
- `evidence/live-verification.json` — the same record, kept with the
  receipts.
- `tests/local_tests.py` — 112 local mock tests (pure SHA-256 vs
  hashlib, date math, verdict truth table, full lifecycle money math
  in wei, frozen/resolve path, staleness gate). Run with
  `python3 tests/local_tests.py`. These are local mocks, not on-chain
  evidence; the on-chain flow is `scripts/flow.mjs` and the
  independent read-back is `scripts/verify.mjs`.

## 4. The mechanism question

- `docs/mechanism.md` — the worst-case spread calculation: two
  validator-compatible leader outputs differ by exactly `0` in flags,
  verdict, and GEN, because validation requires exact flag-vector
  agreement and the verdict is computed from the agreed flags.
